import express from 'express';
import puppeteer from 'puppeteer';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
    
    // Launch browser with Render.com optimized settings
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
        '--disable-javascript',
        '--disable-default-apps'
      ],
      timeout: 30000
    });

    // Process URLs with controlled concurrency
    const concurrency = Math.min(options.concurrency || 2, 3); // Max 3 concurrent
    const chunks = chunkArray(urls, concurrency);
    
    for (const chunk of chunks) {
      const chunkPromises = chunk.map(url => scrapeUrl(browser, url, options));
      const chunkResults = await Promise.allSettled(chunkPromises);
      
      chunkResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          console.error(`Failed to scrape ${chunk[index]}:`, result.reason?.message);
          results.push({
            url: chunk[index],
            success: false,
            error: result.reason?.message || 'Unknown error',
            data: null
          });
        }
      });
      
      // Brief pause between chunks
      if (chunks.indexOf(chunk) < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    const processingTime = Date.now() - startTime;
    console.log(`Completed scraping in ${processingTime}ms`);

    res.json({
      success: true,
      totalUrls: urls.length,
      successfulScrapes: results.filter(r => r.success).length,
      products: results,
      processingTimeMs: processingTime,
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scraping error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      products: results,
      processingTimeMs: Date.now() - startTime
    });
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('Error closing browser:', closeError);
      }
    }
  }
});

async function scrapeUrl(browser, url, options) {
  const page = await browser.newPage();
  
  try {
    // Optimized page settings
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 720 });
    
    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const resourceType = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log(`Scraping: ${url}`);
    
    // Navigate to page with timeout
    const response = await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: options.timeout || 20000 
    });

    if (!response || !response.ok()) {
      throw new Error(`HTTP ${response?.status() || 'unknown'}: ${response?.statusText() || 'Failed to load'}`);
    }

    // Wait for content if selector provided
    if (options.waitForSelector) {
      try {
        await page.waitForSelector(options.waitForSelector, { timeout: 3000 });
      } catch (e) {
        console.warn(`Selector ${options.waitForSelector} not found on ${url}`);
      }
    }

    // Extract data using provided selectors
    const extractedData = await page.evaluate((selectors) => {
      const data = {};
      
      if (!selectors) return data;
      
      for (const [key, selector] of Object.entries(selectors)) {
        try {
          if (key === 'images') {
            const imgs = Array.from(document.querySelectorAll(selector));
            data[key] = imgs.map(img => ({
              src: img.src || img.dataset.src || img.getAttribute('data-src'),
              alt: img.alt || ''
            })).filter(img => img.src);
          } else {
            const element = document.querySelector(selector);
            if (element) {
              data[key] = element.textContent?.trim() || element.innerText?.trim() || '';
            }
          }
        } catch (e) {
          console.warn(`Error extracting ${key}:`, e.message);
        }
      }
      
      return data;
    }, options.extractData || {});

    // Try to extract Shopify product data
    const shopifyData = await page.evaluate(() => {
      try {
        // Look for product JSON in scripts
        const scripts = Array.from(document.querySelectorAll('script'));
        for (const script of scripts) {
          const content = script.textContent || script.innerHTML;
          if (content.includes('"product"') && content.includes('"variants"')) {
            const productMatch = content.match(/(?:product|Product)\s*[:=]\s*({[^}]*"variants"[^}]*})/);
            if (productMatch) {
              return JSON.parse(productMatch[1]);
            }
          }
        }
        return null;
      } catch (e) {
        return null;
      }
    });

    return {
      url,
      success: true,
      data: {
        ...extractedData,
        shopifyProduct: shopifyData
      },
      scrapedAt: new Date().toISOString()
    };

  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return {
      url,
      success: false,
      error: error.message,
      data: null
    };
  } finally {
    await page.close();
  }
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

app.listen(port, '0.0.0.0', () => {
  console.log(`Puppeteer microservice running on port ${port}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');  
  process.exit(0);
});
