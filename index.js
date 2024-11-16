const fs = require('fs');
const path = require('path');
const { markdown } = require('markdown');

function listFilesAndExports(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      listFilesAndExports(filePath, fileList);
    } else if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.py')) {
      const exports = getExports(filePath);
      fileList.push({ filePath, exports });
    }
  });

  return fileList;
}

function getExports(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  const exports = [];
  let match;

  while ((match = exportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  return exports;
}

function generateMarkdownReport(fileList) {
  let report = '# Project File Structure\n\n';

  fileList.forEach(file => {
    report += `## ${file.filePath}\n\n`;
    report += '### Exports:\n';
    file.exports.forEach(exp => {
      report += `- ${exp}\n`;
    });
    report += '\n';
  });

  return report;
}

function writeReportIfChanged(report) {
  const reportPath = path.join('.github', 'copilot-instructions.md');
  let existingReport = '';

  if (fs.existsSync(reportPath)) {
    existingReport = fs.readFileSync(reportPath, 'utf-8');
  }

  if (existingReport !== report) {
    fs.writeFileSync(reportPath, report, 'utf-8');
  }
}

const mainDir = path.join(__dirname, 'src');
const testDir = path.join(__dirname, 'test');

const mainFiles = listFilesAndExports(mainDir);
const testFiles = listFilesAndExports(testDir);

const allFiles = [...mainFiles, ...testFiles];
const markdownReport = generateMarkdownReport(allFiles);

writeReportIfChanged(markdownReport);
