import fs from 'fs';
import path from 'path';

const files = [
  'TeacherAICoach.tsx',
  'Doubts.tsx',
  'Leave.tsx',
  'Profile.tsx',
  'TeacherApp.tsx',
  'TeacherAttendancePage.tsx',
  'LiveHomeworkPanels.tsx',
  'LiveClassPanels.tsx'
];

const basePath = process.cwd();

const replacements = [
  [/bg-white\/5/g, 'bg-muted'],
  [/bg-white\/8/g, 'bg-muted/80'],
  [/bg-white\/10/g, 'bg-muted/80'],
  [/text-white(?!\/)/g, 'text-foreground'],
  [/border-white\/5/g, 'border-border'],
  [/border-white\/8/g, 'border-border'],
  [/border-white\/10/g, 'border-border'],
];

files.forEach(file => {
  const filePath = path.join(basePath, file);
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let changed = false;

    replacements.forEach(([pattern, replacement]) => {
      const newContent = content.replace(pattern, replacement);
      if (newContent !== content) {
        content = newContent;
        changed = true;
      }
    });

    if (changed) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✓ Fixed ${file}`);
    } else {
      console.log(`- No changes needed in ${file}`);
    }
  } catch (err) {
    console.error(`✗ Error processing ${file}:`, err.message);
  }
});

console.log('\nDone!');
