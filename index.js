const fs = require('fs');
const path = require('path');
const Parser = require('tree-sitter');
const Python = require('tree-sitter-python');
const JavaScript = require('tree-sitter-javascript');

// Initialize parser and languages
const parser = new Parser();
const pythonParser = Python;
const javascriptParser = JavaScript;

function shouldIncludePath(filePath, includePaths) {
  if (!includePaths || includePaths.length === 0) return true;
  return includePaths.some(includePath => filePath.startsWith(includePath));
}

function getPackageDirectories() {
  const packageDirs = [];

  // Check for JavaScript package.json
  const packageJsonPath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
    if (packageJson.name) {
      packageDirs.push({ path: process.cwd(), type: 'js' });
    }
    if (packageJson.workspaces) {
      const workspaces = packageJson.workspaces;
      workspaces.forEach(workspace => {
        const workspacePath = path.join(process.cwd(), workspace);
        packageDirs.push({ path: workspacePath, type: 'js' });
      });
    }
  }

  // Check for Python setup.py and pyproject.toml
  const setupPyPath = path.join(process.cwd(), 'setup.py');
  const pyprojectTomlPath = path.join(process.cwd(), 'pyproject.toml');

  if (fs.existsSync(setupPyPath) || fs.existsSync(pyprojectTomlPath)) {
    packageDirs.push({ path: process.cwd(), type: 'py' });
  }

  return packageDirs;
}

function listFilesAndExports(dir, fileList = [], includePaths = []) {
  // Get package directories
  const packageDirs = getPackageDirectories();
  // Convert to normalized paths
  const normalizedPackageDirs = packageDirs.map(p => path.normalize(p.path));

  if (!fs.existsSync(dir)) return fileList;

  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    // Exclude node_modules directory
    if (file === 'node_modules') {
      return;
    }

    if (stat.isDirectory()) {
      // Only include directories that are in package directories
      if (normalizedPackageDirs.some(pkgDir => filePath.startsWith(pkgDir))) {
        listFilesAndExports(filePath, fileList, includePaths);
      }
    } else if ((file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.py'))) {
      // Only include files that are in package directories
      if (normalizedPackageDirs.some(pkgDir => filePath.startsWith(pkgDir))) {
        const exports = getExports(filePath);
        fileList.push({ filePath: path.relative(process.cwd(), filePath), exports });
      }
    }
  });

  return fileList;
}

function getExports(filePath) {
  const ext = path.extname(filePath);
  const code = fs.readFileSync(filePath, 'utf-8');
  
  if (ext === '.py') {
    parser.setLanguage(pythonParser);
  } else if (ext === '.js' || ext === '.ts') {
    parser.setLanguage(javascriptParser);
  } else {
    return [];
  }

  const tree = parser.parse(code);
  return extractExports(tree.rootNode, ext);
}

function extractExports(rootNode, extension) {
  const exports = [];
  const nodesToVisit = [rootNode];

  while (nodesToVisit.length > 0) {
    const node = nodesToVisit.pop();

    if (extension === '.py') {
      if (node.type === 'class_definition') {
        const nameNode = node.childForFieldName('name');
        const className = nameNode ? nameNode.text : 'UnnamedClass';
        const classExports = { name: className, methods: [] };

        const suiteNode = node.childForFieldName('body');
        if (suiteNode) {
          suiteNode.namedChildren.forEach(child => {
            if (child.type === 'function_definition') {
              const methodNameNode = child.childForFieldName('name');
              if (methodNameNode) {
                classExports.methods.push(methodNameNode.text);
              }
            }
          });
        }
        exports.push(classExports);
      } else if (node.type === 'function_definition') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) exports.push({ name: nameNode.text });
      }
    } else if (extension === '.js' || extension === '.ts') {
      if (node.type === 'class_declaration') {
        const nameNode = node.childForFieldName('name');
        const className = nameNode ? nameNode.text : 'UnnamedClass';
        const classExports = { name: className, methods: [] };

        node.namedChildren.forEach(child => {
          if (child.type === 'method_definition') {
            const methodNameNode = child.childForFieldName('name');
            if (methodNameNode) {
              classExports.methods.push(methodNameNode.text);
            }
          }
        });
        exports.push(classExports);
      } else if (node.type === 'function_declaration') {
        const nameNode = node.childForFieldName('name');
        if (nameNode) exports.push({ name: nameNode.text });
      } else if (node.type === 'export_statement') {
        // Handle exports if necessary
      }
    }

    nodesToVisit.push(...node.children);
  }

  return exports;
}

function generateMarkdownReport(fileList) {
  const startMarker = '<!-- BEGIN GENERATED CONTENT -->';
  const endMarker = '<!-- END GENERATED CONTENT -->';
  let report = '';

  report += `${startMarker}\n`;

  const packageDirs = getPackageDirectories();

  packageDirs.forEach(packageInfo => {
    const packagePath = path.relative(process.cwd(), packageInfo.path) || '.';
    const packageType = packageInfo.type;
    report += `## Package (${packageType}): \`${packagePath}\`\n\n`;
    const packageFiles = fileList.filter(file => file.filePath.startsWith(packagePath));

    const dirStructure = {};

    packageFiles.forEach(file => {
      const relativePath = path.relative(packageInfo.path, path.join(process.cwd(), file.filePath));
      const parts = relativePath.split(path.sep);
      let current = dirStructure;

      parts.forEach((part, index) => {
        if (!current[part]) {
          current[part] = index === parts.length - 1 ? { exports: file.exports } : {};
        }
        current = current[part];
      });
    });

    function generateTree(dir, indent = '') {
      let output = '';
      for (const key in dir) {
        if (dir[key].exports) {
          output += `${indent}- ${key}\n`;
          dir[key].exports.forEach(exp => {
            if (exp.methods && exp.methods.length > 0) {
              output += `${indent}  - ${exp.name}\n`;
              exp.methods.forEach(method => {
                output += `${indent}    - ${method}\n`;
              });
            } else {
              output += `${indent}  - ${exp.name}\n`;
            }
          });
        } else {
          output += `${indent}- ${key}/\n`;
          output += generateTree(dir[key], indent + '  ');
        }
      }
      return output;
    }

    report += generateTree(dirStructure);
    report += '\n';
  });

  report += `${endMarker}\n`;
  return report;
}

function writeReportIfChanged(report) {
  const reportPath = path.join('.github', 'copilot-instructions.md');
  const startMarker = '<!-- BEGIN GENERATED CONTENT -->';
  const endMarker = '<!-- END GENERATED CONTENT -->';

  let existingContent = '';
  if (fs.existsSync(reportPath)) {
    existingContent = fs.readFileSync(reportPath, 'utf-8');
    const startIndex = existingContent.indexOf(startMarker);
    const endIndex = existingContent.indexOf(endMarker) + endMarker.length;

    if (startIndex !== -1 && endIndex !== -1) {
      const before = existingContent.substring(0, startIndex);
      const after = existingContent.substring(endIndex);
      report = before + report + after;
    } else {
      report = existingContent + '\n' + report;
    }
  }

  fs.writeFileSync(reportPath, report, 'utf-8');
}

function main() {
  // Get paths from command line arguments or scan everything
  const pathsArg = process.argv[2];
  const includePaths = pathsArg ? pathsArg.split(',').map(p => p.trim()) : [];
  
  const allFiles = listFilesAndExports(process.cwd(), [], includePaths);
  const markdownReport = generateMarkdownReport(allFiles);
  writeReportIfChanged(markdownReport);
}

main();
