const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');

const LOGO_PATH = path.join(__dirname, '../public/img/logo.png');
const BRAND_NAME = 'CommitTime';
const BRAND_COLOR = '#7c3aed';

const REPORT_QUERY = `
  SELECT te.description, te.start_time, te.end_time, te.billable,
         u.name as user_name,
         p.name as project_name, p.hourly_rate,
         EXTRACT(EPOCH FROM (COALESCE(te.end_time, NOW()) - te.start_time)) as duration_seconds,
         CASE
           WHEN p.hourly_rate IS NOT NULL AND (te.billable OR p.billable)
           THEN (EXTRACT(EPOCH FROM (COALESCE(te.end_time, NOW()) - te.start_time)) / 3600.0) * p.hourly_rate
           ELSE 0
         END as amount
  FROM time_entries te
  JOIN users u ON u.id = te.user_id
  LEFT JOIN projects p ON p.id = te.project_id
  WHERE te.workspace_id = $1
    AND te.start_time >= $2::timestamptz
    AND te.start_time <= $3::timestamptz
  ORDER BY te.start_time DESC
`;

function parseReportDates(start, end) {
  let startDate = start;
  let endDate = end;
  if (start && !start.includes('T')) startDate = `${start}T00:00:00.000Z`;
  if (end && !end.includes('T')) endDate = `${end}T23:59:59.999Z`;
  if (!startDate) {
    const d = new Date();
    startDate = new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  }
  if (!endDate) endDate = new Date().toISOString();
  return { startDate, endDate };
}

function csvEscape(val) {
  const s = String(val == null ? '' : val);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes(';')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function formatBrDate(isoOrDate) {
  const d = typeof isoOrDate === 'string' && isoOrDate.length === 10
    ? new Date(isoOrDate + 'T12:00:00')
    : new Date(isoOrDate);
  return d.toLocaleDateString('pt-BR');
}

function formatBrDateTime(iso) {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function fetchReportEntries(db, workspaceId, startDate, endDate) {
  const result = await db.query(REPORT_QUERY, [workspaceId, startDate, endDate]);
  const totalSeconds = result.rows.reduce((s, r) => s + (parseFloat(r.duration_seconds) || 0), 0);
  const totalAmount = result.rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);
  return { rows: result.rows, totalSeconds, totalAmount };
}

function buildCsv(rows, totalSeconds, totalAmount, start, end) {
  const meta = [
    `CommitTime - Relatorio de Tempo`,
    `Periodo: ${formatBrDate(start)} a ${formatBrDate(end)}`,
    '',
  ];
  const header = ['Usuario', 'Projeto', 'Descricao', 'Inicio', 'Fim', 'Horas', 'Taxa/h', 'Valor', 'Faturavel'];
  const lines = rows.map((r) => {
    const hours = ((parseFloat(r.duration_seconds) || 0) / 3600).toFixed(2);
    const rate = r.hourly_rate ? parseFloat(r.hourly_rate).toFixed(2) : '';
    const amount = (parseFloat(r.amount) || 0).toFixed(2);
    return [
      csvEscape(r.user_name),
      csvEscape(r.project_name || 'Sem projeto'),
      csvEscape(r.description || ''),
      csvEscape(formatBrDateTime(r.start_time)),
      csvEscape(r.end_time ? formatBrDateTime(r.end_time) : 'Em andamento'),
      hours,
      rate,
      amount,
      r.billable ? 'Sim' : 'Nao',
    ].join(';');
  });

  lines.push('');
  lines.push(['', '', 'TOTAL', '', '', (totalSeconds / 3600).toFixed(2), '', totalAmount.toFixed(2), ''].join(';'));

  return '\uFEFF' + meta.join('\n') + header.join(';') + '\n' + lines.join('\n');
}

function truncate(text, max) {
  const s = String(text || '');
  return s.length > max ? s.slice(0, max - 3) + '...' : s;
}

function streamPdf(res, { rows, totalSeconds, totalAmount, start, end, workspaceName }) {
  const startLabel = formatBrDate(start);
  const endLabel = formatBrDate(end);
  const filename = `relatorio-${String(start).slice(0, 10)}-${String(end).slice(0, 10)}.pdf`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  doc.pipe(res);

  let headerY = 40;
  if (fs.existsSync(LOGO_PATH)) {
    const logoW = 130;
    doc.image(LOGO_PATH, (doc.page.width - logoW) / 2, headerY, { width: logoW });
    headerY += 95;
  }

  doc.y = headerY;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BRAND_COLOR)
    .text('Relatorio de Tempo', { align: 'center' });
  doc.font('Helvetica').fontSize(11).fillColor('#444444')
    .text(`Workspace: ${workspaceName}`, { align: 'center' })
    .text(`Periodo: ${startLabel} ate ${endLabel}`, { align: 'center' })
    .moveDown(1.2);

  doc.font('Helvetica-Bold').fontSize(12).fillColor('#111111')
    .text(`Total de horas: ${(totalSeconds / 3600).toFixed(2)} h`);
  doc.text(`Valor faturavel: R$ ${totalAmount.toFixed(2).replace('.', ',')}`);
  doc.moveDown(1);

  const colX = [40, 115, 215, 330, 395, 460];
  const headers = ['Usuario', 'Projeto', 'Inicio', 'Horas', 'Valor', 'Fat.'];

  function drawTableHeader() {
    const y = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#ffffff');
    doc.rect(40, y, 515, 16).fill(BRAND_COLOR);
    headers.forEach((h, i) => doc.text(h, colX[i], y + 4, { width: (colX[i + 1] || 555) - colX[i] - 4 }));
    doc.y = y + 20;
  }

  drawTableHeader();

  if (rows.length === 0) {
    doc.font('Helvetica').fontSize(10).fillColor('#666666')
      .text('Nenhuma entrada de tempo no periodo selecionado.', 40, doc.y);
  } else {
    rows.forEach((r, idx) => {
      if (doc.y > 740) {
        doc.addPage();
        drawTableHeader();
      }

      const hours = ((parseFloat(r.duration_seconds) || 0) / 3600).toFixed(2);
      const amount = (parseFloat(r.amount) || 0).toFixed(2).replace('.', ',');
      const bg = idx % 2 === 0 ? '#f5f7fa' : '#ffffff';
      const y = doc.y;

      doc.rect(40, y, 515, 18).fill(bg);
      doc.font('Helvetica').fontSize(7.5).fillColor('#222222');
      doc.text(truncate(r.user_name, 18), colX[0], y + 5, { width: 70 });
      doc.text(truncate(r.project_name || 'Sem projeto', 22), colX[1], y + 5, { width: 95 });
      doc.text(formatBrDateTime(r.start_time), colX[2], y + 5, { width: 110 });
      doc.text(hours, colX[3], y + 5, { width: 55 });
      doc.text(`R$ ${amount}`, colX[4], y + 5, { width: 55 });
      doc.text(r.billable ? 'Sim' : 'Nao', colX[5], y + 5, { width: 40 });
      doc.y = y + 20;
    });

    if (doc.y > 720) doc.addPage();
    doc.moveDown(0.5);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111111')
      .text(`TOTAL: ${(totalSeconds / 3600).toFixed(2)} h  |  R$ ${totalAmount.toFixed(2).replace('.', ',')}`, 40);
  }

  doc.font('Helvetica').fontSize(8).fillColor('#888888')
    .text(`Gerado em ${formatBrDateTime(new Date().toISOString())} — ${BRAND_NAME}`, 40, doc.page.height - 50, { align: 'center' });

  doc.end();
}

module.exports = {
  parseReportDates,
  fetchReportEntries,
  buildCsv,
  streamPdf,
};
