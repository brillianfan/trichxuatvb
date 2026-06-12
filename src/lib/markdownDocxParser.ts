import { 
  Paragraph, 
  TextRun, 
  Table, 
  TableRow, 
  TableCell, 
  HeadingLevel,
  BorderStyle,
  WidthType
} from "docx";

/**
 * Parses inline markdown (bold/italic) from a line of text into styled TextRun objects.
 */
export function parseInlineMarkdownToRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  
  // Regex to detect underline (<u>), bold-italic (***), bold (**), and italic (*)
  // We match:
  // Gr 1-2: Underline <u>text</u>
  // Gr 3-4: bold-italic (e.g. ***bold italic***)
  // Gr 5-6: bold (e.g. **bold**)
  // Gr 7-8: italic (e.g. *italic*)
  const regex = /(<u>)(.*?)(<\/u>)|(\*\*\*)(.*?)\4|(\*\*)(.*?)\6|(\*)(.*?)\8/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Add plain text before match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.substring(lastIndex, match.index) }));
    }

    const [ , , uText, , , boldItalicText, , boldText, , italicText] = match;

    if (uText !== undefined) {
      runs.push(new TextRun({ text: uText, underline: {} }));
    } else if (boldItalicText !== undefined) {
      runs.push(new TextRun({ text: boldItalicText, bold: true, italics: true }));
    } else if (boldText !== undefined) {
      runs.push(new TextRun({ text: boldText, bold: true }));
    } else if (italicText !== undefined) {
      runs.push(new TextRun({ text: italicText, italics: true }));
    }

    lastIndex = regex.lastIndex;
  }

  // Add remaining plain text
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.substring(lastIndex) }));
  }

  // Fallback if no runs were created
  if (runs.length === 0 && text.trim().length > 0) {
    runs.push(new TextRun({ text }));
  }

  return runs;
}

/**
 * Converts a Markdown string into an array of docx components (Paragraphs, Tables, etc.).
 */
export function convertMarkdownToDocxComponents(markdown: string): any[] {
  const components: any[] = [];
  const lines = markdown.split("\n");
  
  let inTable = false;
  let tableRows: string[][] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const origLine = lines[i];
    const line = origLine.trim();
    
    // 1. Table Detection
    if (line.startsWith("|") && line.endsWith("|")) {
      // Check if it's a separator line (e.g. |---|---|)
      const isSeparator = /^[|\s:-]+$/.test(line);
      if (isSeparator) {
        // Just skip table header separator line
        continue;
      }
      
      inTable = true;
      // Parse cells
      const cells = origLine
        .split("|")
        .map(cell => cell.trim())
        .slice(1, -1); // Remove empty ends from outer pipeline walls
        
      tableRows.push(cells);
      continue;
    } else {
      // If we were in a table and this line is NOT a table row, process the table first
      if (inTable && tableRows.length > 0) {
        components.push(createDocxTable(tableRows));
        tableRows = [];
        inTable = false;
      }
    }
    
    if (line === "") {
      // Add thin line break spacing
      components.push(new Paragraph({
        spacing: { after: 120 }
      }));
      continue;
    }
    
    // 2. Heading 1
    if (line.startsWith("# ")) {
      components.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: parseInlineMarkdownToRuns(line.substring(2)),
        spacing: { before: 240, after: 120 }
      }));
      continue;
    }
    
    // 3. Heading 2
    if (line.startsWith("## ")) {
      components.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: parseInlineMarkdownToRuns(line.substring(3)),
        spacing: { before: 200, after: 100 }
      }));
      continue;
    }
    
    // 4. Heading 3
    if (line.startsWith("### ")) {
      components.push(new Paragraph({
        heading: HeadingLevel.HEADING_3,
        children: parseInlineMarkdownToRuns(line.substring(4)),
        spacing: { before: 180, after: 80 }
      }));
      continue;
    }
    
    // 5. Unordered List Items
    if (line.startsWith("- ") || line.startsWith("* ")) {
      const bulletText = line.substring(2);
      components.push(new Paragraph({
        bullet: { level: 0 },
        children: parseInlineMarkdownToRuns(bulletText),
        spacing: { after: 100 }
      }));
      continue;
    }
    
    // 6. Ordered List Items
    const numberedListMatch = line.match(/^(\d+)\.\s+(.*)/);
    if (numberedListMatch) {
      const numPrefix = numberedListMatch[1];
      const itemText = numberedListMatch[2];
      
      // We manually indent and prepend ordered numbers to preserve pristine formatting in word
      const runs = [
        new TextRun({ text: `${numPrefix}.  `, bold: true }),
        ...parseInlineMarkdownToRuns(itemText)
      ];
      
      components.push(new Paragraph({
        children: runs,
        indent: { left: 360 }, // Beautiful left padding for lists
        spacing: { after: 100 }
      }));
      continue;
    }
    
    // 7. Regular paragraph
    components.push(new Paragraph({
      children: parseInlineMarkdownToRuns(origLine),
      spacing: { after: 160 }
    }));
  }
  
  // Cleanup any trailing table
  if (inTable && tableRows.length > 0) {
    components.push(createDocxTable(tableRows));
  }
  
  return components;
}

/**
 * Creates a native docx Table with nice borders and formatting
 */
function createDocxTable(rows: string[][]): Table {
  return new Table({
    width: {
      size: 100,
      type: WidthType.PERCENTAGE
    },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
      left: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
      right: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
    },
    rows: rows.map((rowData, rowIndex) => {
      const isHeader = rowIndex === 0;
      return new TableRow({
        tableHeader: isHeader,
        children: rowData.map(cellText => {
          return new TableCell({
            children: [
              new Paragraph({
                children: parseInlineMarkdownToRuns(cellText),
                spacing: { before: 100, after: 100 }
              })
            ],
            shading: {
              fill: isHeader ? "F1F5F9" : "FFFFFF"
            }
          });
        })
      });
    })
  });
}
