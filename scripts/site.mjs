import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCHEMA, verifyEvidence } from '../src/release/evidence.mjs';
import { renderReport } from '../web/render.mjs';

const releaseReport = 'artifacts/release-report.json';
const legacyReport = 'artifacts/afterflag-report.json';
const defaultReport = existsSync(releaseReport) || !existsSync(legacyReport) ? releaseReport : legacyReport;
const reportPath = resolve(process.env.AFTERFLAG_REPORT ?? defaultReport);
const outputDir = resolve(process.env.AFTERFLAG_SITE ?? 'site');
const readAsset = (name) => readFileSync(new URL('../web/' + name, import.meta.url), 'utf8');
const rawReport = readFileSync(reportPath);
const report = JSON.parse(rawReport.toString('utf8'));
const isReleaseProof = report?.schema === SCHEMA;
if (isReleaseProof) {
  try {
    verifyEvidence(report);
  } catch (error) {
    throw new Error('Cannot package release proof: ' + error.message, { cause: error });
  }
}
const sections = {
  ...renderReport(report, { verified: isReleaseProof }),
  STYLE: readAsset('style.css'),
  SCRIPT: readAsset('viewer.js')
};
const html = readAsset('index.html').replace(/%%([A-Z_]+)%%/g, (marker, name) => {
  if (!Object.hasOwn(sections, name)) throw new Error('Unknown site template slot ' + marker);
  return sections[name];
});

mkdirSync(outputDir, { recursive: true });
writeFileSync(resolve(outputDir, 'report.json'), rawReport);
writeFileSync(resolve(outputDir, 'index.html'), html);
console.log(outputDir);
