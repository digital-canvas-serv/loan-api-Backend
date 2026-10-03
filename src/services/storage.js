import { put, del, head, createClient } from '@vercel/blob';

const client = createClient({ token: process.env.BLOB_READ_WRITE_TOKEN });

export async function uploadToBlob(file, options = {}) {
  const { filename, contentType, access = 'private' } = options;
  
  const blob = await put(filename, file, {
    access,
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN,
    addRandomSuffix: true,
  });
  
  return {
    url: blob.url,
    pathname: blob.pathname,
    contentType: blob.contentType,
    size: blob.size,
  };
}

export async function deleteFromBlob(pathname) {
  await del(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
}

export async function getBlobInfo(pathname) {
  const blob = await head(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  return blob;
}

export async function downloadFromBlob(pathname) {
  const blob = await client.download(pathname, { token: process.env.BLOB_READ_WRITE_TOKEN });
  return blob;
}

export function getBlobDownloadUrl(pathname) {
  return `https://${process.env.BLOB_PUBLIC_DOMAIN || 'blob.vercel-storage.com'}/${pathname}`;
}

export function isBlobConfigured() {
  return !!process.env.BLOB_READ_WRITE_TOKEN;
}