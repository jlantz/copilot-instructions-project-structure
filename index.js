const fs = require('fs');
const path = require('path');

let Parser, Python, JavaScript;
try {
  Parser = require('tree-sitter');
  Python = require('tree-sitter-python');
  JavaScript = require('tree-sitter-javascript');
} catch (error) {
  console.error('Failed to load tree-sitter:', error.message);
  console.error('Please ensure tree-sitter is installed: npm install tree-sitter tree-sitter-python tree-sitter-javascript');
  process.exit(1);
}

// Add this new function to find project root
function findProjectRoot(startDir = process.cwd()) {
  let currentDir = startDir;
  while (currentDir !== path.parse(currentDir).root) {
    if (fs.existsSync(path.join(currentDir, 'package.json'))) {
      return currentDir;
    }
    currentDir = path.dirname(currentDir);
  }
  return startDir;
}

// Add the project root as a constant
const PROJECT_ROOT = findProjectRoot();

// Initialize parser and languages
const parser = new Parser();
const pythonParser = Python; // Remove the function call
const javascriptParser = JavaScript;

function shouldIncludePath(filePath, includePaths) {
  if (!includePaths || includePaths.length === 0) return true;
  return includePaths.some(includePath => filePath.startsWith(includePath));
}

// Modify getPackageDirectories to include includePaths
function getPackageDirectories(includePaths = []) {
  const packageDirs = [];
  const currentDir = PROJECT_ROOT;  // Changed from process.cwd()

  // Check for JavaScript package.json in root only
  const packageJsonPath = path.join(currentDir, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    console.log('Found package.json at:', packageJsonPath);
    packageDirs.push({ path: currentDir, type: 'js' });
    
    // Look for Python packages
    const pypackages = [];
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      // Skip dist, node_modules and dot directories
      if (entry.isDirectory() && !entry.name.startsWith('.') && 
          entry.name !== 'node_modules' && entry.name !== 'dist') {
        const subdir = path.join(currentDir, entry.name);
        
        // Check for JavaScript packages
        if (fs.existsSync(path.join(subdir, 'package.json'))) {
          packageDirs.push({ path: subdir, type: 'js' });
        }
        
        // Check for Python packages
        if (fs.existsSync(path.join(subdir, 'setup.py')) || fs.existsSync(path.join(subdir, 'pyproject.toml'))) {
          pypackages.push({ path: subdir, type: 'py' });
        }
      }
    }
    packageDirs.push(...pypackages);
  }

  // Include additional paths provided via command line arguments
  includePaths.forEach(includePath => {
    const fullPath = path.join(PROJECT_ROOT, includePath);
    if (fs.existsSync(fullPath)) {
      const stats = fs.statSync(fullPath);
      if (stats.isDirectory()) {
        // Determine package type based on content
        if (fs.existsSync(path.join(fullPath, 'package.json'))) {
          packageDirs.push({ path: fullPath, type: 'js' });
        }
        if (fs.existsSync(path.join(fullPath, 'setup.py')) || fs.existsSync(path.join(fullPath, 'pyproject.toml'))) {
          packageDirs.push({ path: fullPath, type: 'py' });
        }
      }
    }
  });

  console.log('Found packages:', packageDirs);
  return packageDirs;
}

// Modify listFilesAndExports to pass includePaths to getPackageDirectories
function listFilesAndExports(dir, fileList = [], includePaths = []) {
  // Get package directories including the specified includePaths
  const packageDirs = getPackageDirectories(includePaths);
  console.log('Scanning directory:', dir);
  
  if (!fs.existsSync(dir)) {
    console.warn('Directory does not exist:', dir);
    return fileList;
  }

  const files = fs.readdirSync(dir);
  console.log(`Found ${files.length} files/directories in ${dir}`);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    // Skip node_modules and dot directories
    if (file === 'node_modules' || file.startsWith('.') || file === 'dist') {
      console.log('Skipping directory:', file);
      continue;
    }

    if (stat.isDirectory()) {
      listFilesAndExports(filePath, fileList, includePaths);
    } else if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.py')) {
      console.log('Processing file:', filePath);
      const exports = getExports(filePath);
      console.log('Exports:', exports);
      if (exports && exports.length > 0) {
        fileList.push({ 
          filePath: path.relative(PROJECT_ROOT, filePath),  // Changed from process.cwd()
          exports 
        });
        console.log('Added to fileList:', filePath, 'with exports:', exports);
      }
    }
  }
  console.log('Current fileList:', fileList);
  return fileList;
}

function getExports(filePath) {
  try {
    const ext = path.extname(filePath);
    let code;
    
    try {
      code = fs.readFileSync(filePath, 'utf-8');
      if (!code || typeof code !== 'string') {
        console.warn(`Invalid file content for ${filePath}`);
        return [];
      }
      // Ensure code ends with newline to prevent parsing issues
      if (!code.endsWith('\n')) {
        code += '\n';
      }
    } catch (readError) {
      console.warn(`Failed to read file ${filePath}: ${readError.message}`);
      return [];
    }

    // Create a new parser instance for each file
    const fileParser = new Parser();
    
    if (ext === '.py') {
      fileParser.setLanguage(pythonParser);
    } else if (ext === '.js' || ext === '.ts') {
      fileParser.setLanguage(javascriptParser);
    } else {
      console.warn(`Unsupported file extension: ${ext}`);
      return [];
    }

    try {
      const tree = fileParser.parse(code);
      if (!tree || !tree.rootNode) {
        console.warn(`Failed to parse ${filePath}: Invalid syntax tree`);
        return [];
      }
      return extractExports(tree.rootNode, ext);
    } catch (parseError) {
      console.warn(`Failed to parse ${filePath}: ${parseError.message}`);
      return [];
    }
  } catch (error) {
    console.error(`Error processing ${filePath}: ${error.message}`);
    return [];
  }
}

function extractExports(rootNode, extension) {
  const exports = [];
  const nodesToVisit = [rootNode];

  while (nodesToVisit.length > 0) {
    const node = nodesToVisit.pop();
    console.log('Analyzing node type:', node.type);

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
      } else if (node.type === 'export_statement' || node.type === 'lexical_declaration' || node.type === 'variable_declaration') {
        // Add handling for more export types
        const declarations = node.children.filter(child => 
          child.type === 'variable_declarator' || 
          child.type === 'function_declaration' ||
          child.type === 'identifier'
        );
        
        declarations.forEach(decl => {
          const nameNode = decl.childForFieldName('name') || decl;
          if (nameNode && nameNode.text) {
            exports.push({ name: nameNode.text });
          }
        });
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

  const packageDirs = getPackageDirectories();
  
  if (packageDirs.length === 0) {
    report += `## Package (js): \`.\`\n`;
  } else {
    packageDirs.forEach(packageInfo => {
      const packagePath = path.relative(PROJECT_ROOT, packageInfo.path) || '.';
      const packageType = packageInfo.type;
      report += `## Package (${packageType}): \`${packagePath}\`\n\n`;
      
      const packageFiles = fileList.filter(file => 
        file.filePath.startsWith(packagePath) || packagePath === '.');

      const dirStructure = {};

      packageFiles.forEach(file => {
        const relativePath = path.relative(packageInfo.path, path.join(PROJECT_ROOT, file.filePath));
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
  }

  return `${startMarker}\n${report}${endMarker}\n`;
}

// Modify writeReportIfChanged to use PROJECT_ROOT
function writeReportIfChanged(report) {
  // Always write to .github directory in project root
  const reportPath = path.join(PROJECT_ROOT, '.github', 'copilot-instructions.md');  // Changed from process.cwd()
  const githubDir = path.dirname(reportPath);
  console.log('\nFile Write Debug:');
  console.log('1. Target file:', reportPath);
  
  if (!fs.existsSync(githubDir)) {
    console.log('2. Creating .github directory');
    fs.mkdirSync(githubDir, { recursive: true });
  }

  let currentContent = '';
  try {
    currentContent = fs.readFileSync(reportPath, 'utf-8');
    console.log(`Reading from ${reportPath}`);
  } catch (error) {
    console.log(`Creating new file at ${reportPath}`);
    currentContent = `# Copilot Instructions for Project Structure Workflow\n\nJust some sample instructions that should stay in place...\n\n<!-- BEGIN GENERATED CONTENT -->\n## Package (js): \`.\`\n<!-- END GENERATED CONTENT -->\n`;
  }

  const startMarker = '<!-- BEGIN GENERATED CONTENT -->';
  const endMarker = '<!-- END GENERATED CONTENT -->';
  const startIndex = currentContent.indexOf(startMarker);
  const endIndex = currentContent.indexOf(endMarker);

  console.log('4. Markers found:', { startIndex, endIndex });

  if (startIndex !== -1 && endIndex !== -1) {
    const oldContent = currentContent.substring(startIndex, endIndex + endMarker.length);
    console.log('5. Content comparison:');
    console.log('   Old length:', oldContent.length);
    console.log('   New length:', report.length);
    console.log('   Content different:', oldContent !== report);
    
    if (oldContent !== report) {
      const before = currentContent.substring(0, startIndex);
      const after = currentContent.substring(endIndex + endMarker.length);
      const newContent = before + report + after;
      
      try {
        console.log('6. Writing updated content to file');
        fs.writeFileSync(reportPath, newContent, 'utf-8');
        console.log('7. File write successful');
      } catch (error) {
        console.error('7. Error writing file:', error);
      }
    } else {
      console.log('6. No changes needed');
    }
  } else {
    console.log('5. No markers found, writing new content');
    try {
      const newContent = currentContent.trim() + '\n\n' + report + '\n';
      fs.writeFileSync(reportPath, newContent, 'utf-8');
      console.log('6. File write successful');
    } catch (error) {
      console.error('6. Error writing file:', error);
    }
  }
}

// Modify main to pass includePaths to getPackageDirectories
function main() {
  try {
    const pathsArg = process.argv[2];
    const includePaths = pathsArg ? pathsArg.split(',').map(p => p.trim()) : [];
    
    console.log('Scanning directories...');
    const allFiles = listFilesAndExports(PROJECT_ROOT, [], includePaths);  // Changed from process.cwd()
    console.log(`Found ${allFiles.length} files to analyze`);
    
    console.log('Generating markdown report...');
    const markdownReport = generateMarkdownReport(allFiles);
    
    console.log('Writing report...');
    writeReportIfChanged(markdownReport);
    
    console.log('Done!');
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

// Export for CLI usage
module.exports = { main };

// Run if called directly
if (require.main === module) {
  main();
}
