import PptxGenJS from 'pptxgenjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ReportSection {
  type: 'title_page' | 'executive_summary' | 'analysis' | 'data_table' | 'recommendations';
  [key: string]: unknown;
}

export interface ReportSpec {
  title: string;
  author: string;
  date: string;
  connectionName: string;
  sections: ReportSection[];
}

export interface AnalysisSection {
  toolName: string;
  chartId: string;
  findings: string;
  timestamp: number;
  confidence?: number;
}

export interface AnalysisSession {
  userQuestion: string;
  sections: AnalysisSection[];
  connectionName: string;
  finalText: string;
}

// ---------------------------------------------------------------------------
// buildFromSession
// ---------------------------------------------------------------------------

export function buildFromSession(session: AnalysisSession): ReportSpec {
  const title =
    session.userQuestion.length > 80
      ? session.userQuestion.slice(0, 80)
      : session.userQuestion;

  // Executive summary: first 3 sentences from finalText
  const bullets = session.finalText
    .split('. ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 3);

  const sections: ReportSection[] = [];

  // 1. Title page
  sections.push({ type: 'title_page' });

  // 2. Executive summary
  sections.push({ type: 'executive_summary', bullets });

  // 3. Analysis sections (chartDataUrl filled at export time)
  for (const section of session.sections) {
    sections.push({
      type: 'analysis',
      title: section.toolName,
      chartDataUrl: '',
      findings: section.findings,
      confidence: section.confidence ?? 0,
      tools_used: [section.toolName],
    });
  }

  // 4. Recommendations (optional)
  const recSentences = session.finalText
    .split('. ')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .filter((s) => {
      const lower = s.toLowerCase();
      return lower.includes('recommend') || lower.includes('should') || lower.includes('consider');
    });

  if (recSentences.length > 0) {
    sections.push({
      type: 'recommendations',
      items: recSentences.map((sentence) => ({ priority: 'medium', action: sentence })),
    });
  }

  return {
    title,
    author: 'DataIQ User',
    date: new Date().toLocaleDateString(),
    connectionName: session.connectionName,
    sections,
  };
}

// ---------------------------------------------------------------------------
// exportToPDF
// ---------------------------------------------------------------------------

export function exportToPDF(spec: ReportSpec): void {
  // Get or create the print container
  let container = document.getElementById('report-print');
  if (!container) {
    container = document.createElement('div');
    container.id = 'report-print';
    document.body.appendChild(container);
  }

  // Build HTML content
  const sectionHtml = spec.sections
    .map((s) => {
      switch (s.type) {
        case 'title_page':
          return `<div class="cover"><h1>${spec.title}</h1><p>${spec.author} · ${spec.date}</p></div>`;

        case 'executive_summary': {
          const bullets = (s.bullets as string[]) ?? [];
          return `<h2>Executive Summary</h2><ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul>`;
        }

        case 'analysis': {
          const chartDataUrl = s.chartDataUrl as string;
          const confidence = s.confidence as number | undefined;
          const imgTag = chartDataUrl
            ? `<img src="${chartDataUrl}" style="max-width:100%" />`
            : '';
          return `<h2>${s.title as string}</h2>${imgTag}<p>${s.findings as string}</p><p>Confidence: ${Math.round((confidence ?? 0) * 100)}%</p>`;
        }

        case 'data_table': {
          const columns = (s.columns as string[]) ?? [];
          const rows = (s.rows as unknown[][]) ?? [];
          const headerRow = `<tr>${columns.map((c) => `<th>${c}</th>`).join('')}</tr>`;
          const bodyRows = rows
            .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
            .join('');
          return `<h2>${s.title as string}</h2><table>${headerRow}${bodyRows}</table>`;
        }

        case 'recommendations': {
          const items = (s.items as { priority: string; action: string }[]) ?? [];
          return `<h2>Recommendations</h2><ul>${items.map((item) => `<li><strong>${item.priority}</strong>: ${item.action}</li>`).join('')}</ul>`;
        }

        default:
          return '';
      }
    })
    .join('');

  container.innerHTML = `
    <div style="font-family:sans-serif;padding:2rem;">
      <h1>${spec.title}</h1>
      <p>${spec.connectionName} · ${spec.date}</p>
      ${sectionHtml}
    </div>
  `;

  // Inject print style
  const existingStyle = document.getElementById('report-print-style');
  if (existingStyle) existingStyle.remove();
  const style = document.createElement('style');
  style.id = 'report-print-style';
  style.textContent =
    '@media print { body > *:not(#report-print) { display:none!important } #report-print { display:block!important } }';
  document.head.appendChild(style);

  window.print();

  // Cleanup after 2 seconds
  setTimeout(() => {
    container?.remove();
    document.getElementById('report-print-style')?.remove();
  }, 2000);
}

// ---------------------------------------------------------------------------
// exportToPPTX
// ---------------------------------------------------------------------------

export async function exportToPPTX(spec: ReportSpec): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';

  const BG = '0d0d0d';
  const TEXT = 'ffffff';
  const ACCENT = '00d2ff';
  const MUTED = 'a0a0a0';

  // Slide 1 — Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: BG };
  titleSlide.addText(spec.title, {
    x: 0.5,
    y: 2.5,
    w: 12,
    h: 1.2,
    align: 'center',
    fontSize: 36,
    bold: true,
    color: ACCENT,
  });
  titleSlide.addText(`${spec.author} · ${spec.connectionName} · ${spec.date}`, {
    x: 0.5,
    y: 3.9,
    w: 12,
    h: 0.6,
    align: 'center',
    fontSize: 18,
    color: TEXT,
  });

  // Remaining slides per section
  for (const s of spec.sections) {
    if (s.type === 'analysis') {
      const slide = pptx.addSlide();
      slide.background = { color: BG };

      // Title
      slide.addText(s.title as string, {
        x: 0.2,
        y: 0.2,
        w: 10,
        h: 0.6,
        fontSize: 24,
        bold: true,
        color: ACCENT,
      });

      const chartDataUrl = s.chartDataUrl as string;
      const confidence = s.confidence as number | undefined;
      const findings = s.findings as string;

      if (chartDataUrl) {
        slide.addImage({ data: chartDataUrl, x: 0.2, y: 1, w: 5.5, h: 4 });
      }

      // Findings bullets on right side
      const findingsBullets = findings
        .split('. ')
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
        .map((t) => ({ text: t, options: { bullet: true } }));

      slide.addText(findingsBullets, {
        x: 6,
        y: 1,
        w: 3.8,
        h: 4,
        fontSize: 14,
        color: TEXT,
      });

      // Confidence badge
      slide.addText(`Confidence: ${Math.round((confidence ?? 0) * 100)}%`, {
        x: 0.2,
        y: 5.2,
        w: 4,
        h: 0.4,
        fontSize: 12,
        color: MUTED,
      });
    } else if (s.type === 'recommendations') {
      const slide = pptx.addSlide();
      slide.background = { color: BG };

      slide.addText('Recommendations', {
        x: 0.2,
        y: 0.2,
        w: 10,
        h: 0.6,
        fontSize: 24,
        bold: true,
        color: ACCENT,
      });

      const items = (s.items as { priority: string; action: string }[]) ?? [];
      const tableRows: PptxGenJS.TableRow[] = [
        [
          { text: 'Priority', options: { bold: true, color: ACCENT, fontSize: 13 } },
          { text: 'Action', options: { bold: true, color: ACCENT, fontSize: 13 } },
        ],
        ...items.map((item) => [
          { text: item.priority, options: { color: TEXT, fontSize: 13 } },
          { text: item.action, options: { color: TEXT, fontSize: 13 } },
        ]),
      ];

      slide.addTable(tableRows, {
        x: 0.2,
        y: 1,
        w: 12,
        colW: [2, 10],
        color: TEXT,
        fontSize: 13,
        border: { pt: 1, color: MUTED },
      });
    }
  }

  await pptx.writeFile({ fileName: 'DataIQ-Report.pptx' });
}
