const fs = require('fs/promises');
const path = require('path');
const { randomUUID } = require('crypto');
const sanitizeFilename = require('sanitize-filename');
const { config, validateConfig } = require('../src/config');
const store = require('../src/store');
const { extractVehicleFromPdf, findCombustionEquivalents } = require('../src/gemini');

function printUsage() {
  console.log('Uzycie: node scripts/import-pdfs.js <plik.pdf | katalog> [kolejne-sciezki...]');
}

async function ensureUploadDirectory() {
  await fs.mkdir(config.uploadDir, { recursive: true });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectPdfFiles(inputPaths, bucket = []) {
  for (const inputPath of inputPaths) {
    const resolvedPath = path.resolve(inputPath);
    const stats = await fs.stat(resolvedPath);

    if (stats.isDirectory()) {
      const entries = await fs.readdir(resolvedPath);
      const nestedPaths = entries.map((entry) => path.join(resolvedPath, entry));
      await collectPdfFiles(nestedPaths, bucket);
      continue;
    }

    if (/\.pdf$/i.test(resolvedPath)) {
      bucket.push(resolvedPath);
    }
  }

  return bucket;
}

function buildStoredName(originalName) {
  const safeBaseName = sanitizeFilename(originalName || 'config.pdf');
  const extension = path.extname(safeBaseName) || '.pdf';
  return `${Date.now()}-${randomUUID()}${extension}`;
}

async function copyPdfToUploadStorage(sourcePath) {
  const originalName = path.basename(sourcePath);
  const storedName = buildStoredName(originalName);
  const targetPath = path.join(config.uploadDir, storedName);
  await fs.copyFile(sourcePath, targetPath);
  const stats = await fs.stat(targetPath);

  return {
    originalName,
    storedName,
    targetPath,
    sizeBytes: stats.size,
  };
}

async function enrichExtractedVehicles(extraction) {
  const vehicles = Array.isArray(extraction && extraction.vehicles) ? extraction.vehicles : [];

  return Promise.all(
    vehicles.map(async (vehicle) => ({
      ...vehicle,
      combustionEquivalents: await findCombustionEquivalents(vehicle.brand, vehicle.model).catch(() => []),
      createdAt: new Date().toISOString(),
    }))
  );
}

async function importPdf(sourcePath) {
  const copiedFile = await copyPdfToUploadStorage(sourcePath);
  const uploadEntry = await store.createUpload({
    originalname: copiedFile.originalName,
    filename: copiedFile.storedName,
    mimetype: 'application/pdf',
    size: copiedFile.sizeBytes,
  });

  try {
    const extraction = await extractVehicleFromPdf(copiedFile.targetPath, copiedFile.originalName);
    const vehicles = await enrichExtractedVehicles(extraction);
    await store.markUploadCompleted(uploadEntry.id, vehicles);

    return {
      ok: true,
      fileName: copiedFile.originalName,
      uploadId: uploadEntry.id,
      vehicleCount: vehicles.length,
    };
  } catch (error) {
    await store.markUploadFailed(uploadEntry.id, error.message);

    return {
      ok: false,
      fileName: copiedFile.originalName,
      uploadId: uploadEntry.id,
      error: error.message,
    };
  }
}

async function main() {
  const inputPaths = process.argv.slice(2);
  if (!inputPaths.length) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  validateConfig();
  await ensureUploadDirectory();
  await store.initStore();

  const missingPaths = [];
  for (const inputPath of inputPaths) {
    if (!(await pathExists(path.resolve(inputPath)))) {
      missingPaths.push(inputPath);
    }
  }

  if (missingPaths.length) {
    console.error(`Nie znaleziono sciezek: ${missingPaths.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const pdfFiles = await collectPdfFiles(inputPaths);
  if (!pdfFiles.length) {
    console.error('Nie znaleziono zadnych plikow PDF do importu.');
    process.exitCode = 1;
    return;
  }

  console.log(`Znaleziono ${pdfFiles.length} plikow PDF do importu.`);

  let successCount = 0;
  let failureCount = 0;

  for (let index = 0; index < pdfFiles.length; index += 1) {
    const sourcePath = pdfFiles[index];
    console.log(`[${index + 1}/${pdfFiles.length}] Import ${sourcePath}`);

    const result = await importPdf(sourcePath);
    if (result.ok) {
      successCount += 1;
      console.log(`  OK  ${result.fileName} -> uploadId=${result.uploadId}, rekordy=${result.vehicleCount}`);
    } else {
      failureCount += 1;
      console.error(`  ERR ${result.fileName} -> uploadId=${result.uploadId}, blad=${result.error}`);
    }
  }

  console.log(`Import zakonczony. Sukcesy: ${successCount}, bledy: ${failureCount}.`);
  if (failureCount > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exitCode = 1;
});
