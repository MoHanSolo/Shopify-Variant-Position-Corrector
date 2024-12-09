const axios = require('axios');
require('dotenv').config();

const SHOPIFY_STORE = process.env.SHOPIFY_STORE;
const ADMIN_API_VERSION = '2023-10';
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

const apiClient = axios.create({
  baseURL: `https://${SHOPIFY_STORE}.myshopify.com/admin/api/${ADMIN_API_VERSION}/`,
  headers: {
    'X-Shopify-Access-Token': ACCESS_TOKEN,
    'Content-Type': 'application/json'
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryRequest(url, retriesLeft = 5, delay = 1000) {
  try {
    return await apiClient.get(url);
  } catch (error) {
    if (error.response && error.response.status === 429 && retriesLeft > 0) {
      console.warn(`Received 429 Too Many Requests. Retrying in ${delay / 1000} seconds...`);
      await sleep(delay);
      return retryRequest(url, retriesLeft - 1, delay * 2);
    }
    throw error;
  }
}

async function processAllProducts() {
  let url = 'products.json?limit=250';
  let pageNumber = 0;

  while (true) {
    const { data, headers } = await retryRequest(url);
    const products = data.products;
    if (!products || products.length === 0) break;

    pageNumber++;
    console.log(`Processing page ${pageNumber} with ${products.length} products...`);

    for (const product of products) {
      await checkAndReorderVariants(product);
    }

    const linkHeader = headers['link'];
    if (!linkHeader) break;
    const match = linkHeader.match(/<(.*page_info=([^>]*).*)>; rel="next"/);
    if (match && match[2]) {
      const pageInfo = match[2];
      url = `products.json?limit=250&page_info=${pageInfo}`;
    } else {
      break;
    }
  }

  console.log('Finished processing all products.');
}

async function checkAndReorderVariants(product) {
  const variants = product.variants;
  const sampleVariant = variants.find(v => v.title.toLowerCase().includes('sample'));
  const boltVariant = variants.find(v => v.title.toLowerCase().includes('bolt'));
  if (!sampleVariant || !boltVariant) return;

  if (sampleVariant.position < boltVariant.position) {
    console.log(`Reordering Product ID: ${product.id} - "${product.title}"`);
    console.log(`Current Order: Sample (pos: ${sampleVariant.position}) before Bolt (pos: ${boltVariant.position})`);
    await updateVariantPosition(boltVariant.id, sampleVariant.position);
    await sleep(1000); // Delay to avoid rate limits
    await updateVariantPosition(sampleVariant.id, boltVariant.position);
    await sleep(1000); // Delay again after second update
    console.log('Reorder complete.\n');
  }
}

async function updateVariantPosition(variantId, newPosition) {
  // If you encounter 429 errors here as well, consider implementing retry logic similar to retryRequest.
  await apiClient.put(`variants/${variantId}.json`, {
    variant: {
      id: variantId,
      position: newPosition
    }
  });
}

(async () => {
  try {
    await processAllProducts();
  } catch (error) {
    console.error('Error occurred:', error.response ? error.response.data : error);
  }
})();
