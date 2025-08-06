import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Check Chrome installation on startup
async function checkChrome() {
  try {
    console.log('Checking Chrome installation...');
    
    // Try to find Chrome executable
    const possiblePaths = [
      './chrome-cache/chrome/linux-*/chrome-linux*/chrome',
      '/opt/render/project/.cache/puppeteer/chrome/linux-*/chrome-linux*/chrome',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable'
    ];
    
    // Install Chrome if not found
    try {
      console.log('Installing Chrome...');
      execSync('npx puppeteer browsers install chrome --path ./chrome-cache', { stdio: 'inherit' });
      console.log('Chrome installation completed');
    } catch (error) {
      console.error('Chrome installation failed:', error.message);
    }
    
    return true;
  } catch (error) {
    console.error('Chrome check failed:', error.message);
    return false;
  }
}

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'Puppeteer Microservice Running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Chrome installation endpoint for debugging
app.get('/chrome-status', async (req, res) => {
  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    await browser.close();
    res.json({ status: 'Chrome working', timestamp: new Date().toISOString() });
  } catch (error) {
    res.json({ 
      status: 'Chrome failed', 
      error: error.message,
      timestamp: new Date().toISOString() 
    });
  }
});

// Main scraping endpoint
app.post('/scrape', async (req, res) => {
  const { urls, options = {} } = req.body;
  
  if (!urls || !Array.isArray(urls)) {
    return res.status(400).json({ 
      error: 'URLs array is required',
      received: typeof urls 
    });
  }

  let browser = null;
  const results = [];
  const startTime = Date.now();

  try {
    console.log(`Starting browser for ${urls.length} URLs...`);
    
    // Launch browser with all possible Chrome paths
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-web-security',
        '--disable-features=VizDisplayCompositor',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-images',
        '--disable-default-apps'
      ],
      timeout: 30000,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    });

    // Process URLs with controlled concurrency
    const concurrency = Math.min(options.concurrency || 2, 3);
    const chunks = chunkArray(urls, concurrency);
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(url => scrapeUrl(browser, url, options));
      const chunkResults = await Promise.allSettled(chunkPromises);
      
      chunkResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error(`Failed to scrape ${chunk[index]}:`, result.reason.message);
          results.push({
            url: chunk[index],
            success: false,
            error: result.reason.message,
            data: {}
          });
        }
      });
    }

  } catch (error) {
    console.error('Browser launch failed:', error.message);
    return res.status(500).json({
      success: false,
      error: error.message,
      products: [],
      processingTimeMs: Date.now() - startTime
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.error('Error closing browser:', error.message);
      }
    }
  }

  const processingTimeMs = Date.now() - startTime;
  console.log(`Completed scraping in ${processingTimeMs}ms`);

  res.json({
    success: true,
    products: results,
    processingTimeMs,
    totalUrls: urls.length,
    successfulUrls: results.filter(r => r.success).length
  });
});

// Helper function to chunk array
function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Helper function to scrape individual URL
async function scrapeUrl(browser, url, options) {
  const page = await browser.newPage();
  
  try {
    console.log(`Scraping: ${url}`);
    
    await page.setUserAgent('Mozilla/5.0 (compatible; CompeteTracker/1.0)');
    await page.goto(url, { 
      waitUntil: 'networkidle0', 
      timeout: options.timeout || 20000 
    });

    const extractData = options.extractData || {};
    const data = {};

    for (const [key, selector] of Object.entries(extractData)) {
      try {
        const element = await page.$(selector);
        if (element) {
          data[key] = await page.evaluate(el => el.textContent.trim(), element);
        }
      } catch (error) {
        console.error(`Error extracting ${key}:`, error.message);
        data[key] = null;
      }
    }

    return {
      url,
      success: true,
      data,
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return {
      url,
      success: false,
      error: error.message,
      data: {}
    };
  } finally {
    await page.close();
  }
}

// Start server and check Chrome
app.listen(port, async () => {
  console.log(`Puppeteer microservice running on port ${port}`);
  await checkChrome();
});
