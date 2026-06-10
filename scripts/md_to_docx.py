#!/usr/bin/env python3
"""Convert DOCS.md -> DOCS.docx with no third-party deps.

A .docx is just a zip of XML parts. We parse the small subset of Markdown that
DOCS.md actually uses (headings, bullets, tables, fenced code, blockquotes,
**bold**, `code`, horizontal rules) and emit valid WordprocessingML.

Run:  python3 scripts/md_to_docx.py
"""
import os
import re
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'DOCS.md')
OUT = os.path.join(ROOT, 'DOCS.docx')


def xml_escape(s):
    return (s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            .replace('"', '&quot;'))


def runs(text):
    """Inline parse: **bold** and `code` -> a list of <w:r> runs."""
    out = []
    # split on bold and code, keeping delimiters
    parts = re.split(r'(\*\*.+?\*\*|`[^`]+`)', text)
    for p in parts:
        if not p:
            continue
        if p.startswith('**') and p.endswith('**'):
            out.append(('b', p[2:-2]))
        elif p.startswith('`') and p.endswith('`'):
            out.append(('code', p[1:-1]))
        else:
            out.append(('', p))
    return out


def run_xml(kind, text):
    rpr = []
    if kind == 'b':
        rpr.append('<w:b/>')
    if kind == 'code':
        rpr.append('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>')
        rpr.append('<w:color w:val="9C2D41"/>')
    rpr_xml = '<w:rPr>%s</w:rPr>' % ''.join(rpr) if rpr else ''
    return ('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>'
            % (rpr_xml, xml_escape(text)))


def para(text, style=None, bullet=False):
    ppr = []
    if style:
        ppr.append('<w:pStyle w:val="%s"/>' % style)
    if bullet:
        ppr.append('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')
    ppr_xml = '<w:pPr>%s</w:pPr>' % ''.join(ppr) if ppr else ''
    body = ''.join(run_xml(k, t) for k, t in runs(text)) if text else ''
    return '<w:p>%s%s</w:p>' % (ppr_xml, body)


def code_para(line):
    ppr = ('<w:pPr><w:pStyle w:val="Code"/></w:pPr>')
    body = ('<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>'
            '<w:sz w:val="18"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r>'
            % xml_escape(line) if line else '')
    return '<w:p>%s%s</w:p>' % (ppr, body)


def table_xml(rows):
    # rows: list of list[str]; first row is header
    border = ('<w:tblBorders>'
              + ''.join('<w:%s w:val="single" w:sz="4" w:color="CCCCCC"/>' % e
                        for e in ('top', 'left', 'bottom', 'right',
                                  'insideH', 'insideV'))
              + '</w:tblBorders>')
    tbl = ['<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/>%s'
           '<w:tblLook w:firstRow="1"/></w:tblPr>' % border]
    for i, row in enumerate(rows):
        tbl.append('<w:tr>')
        for cell in row:
            shade = ('<w:shd w:val="clear" w:fill="F0F2F5"/>' if i == 0 else '')
            cellruns = ''.join(run_xml(k, t) for k, t in runs(cell))
            bold = '<w:rPr><w:b/></w:rPr>'
            if i == 0:
                cellruns = ('<w:r>%s<w:t xml:space="preserve">%s</w:t></w:r>'
                            % (bold, xml_escape(cell)))
            tbl.append('<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/>%s</w:tcPr>'
                       '<w:p>%s</w:p></w:tc>' % (shade, cellruns))
        tbl.append('</w:tr>')
    tbl.append('</w:tbl>')
    # an empty para after a table (Word requires content separation)
    tbl.append('<w:p/>')
    return ''.join(tbl)


def parse(md):
    blocks = []
    lines = md.split('\n')
    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        # fenced code
        if line.strip().startswith('```'):
            i += 1
            while i < n and not lines[i].strip().startswith('```'):
                blocks.append(code_para(lines[i]))
                i += 1
            i += 1
            continue
        # table: a line with | and the next line is a |---| separator
        if ('|' in line and i + 1 < n
                and re.match(r'^\s*\|?[\s:|-]+\|[\s:|-]*$', lines[i + 1])
                and '-' in lines[i + 1]):
            rows = []
            header = [c.strip() for c in line.strip().strip('|').split('|')]
            rows.append(header)
            i += 2
            while i < n and '|' in lines[i] and lines[i].strip().startswith('|'):
                rows.append([c.strip() for c in
                             lines[i].strip().strip('|').split('|')])
                i += 1
            blocks.append(table_xml(rows))
            continue
        stripped = line.strip()
        if not stripped:
            i += 1
            continue
        # headings
        m = re.match(r'^(#{1,6})\s+(.*)$', stripped)
        if m:
            level = min(len(m.group(1)), 4)
            blocks.append(para(strip_inline_md(m.group(2)),
                               style='Heading%d' % level))
            i += 1
            continue
        # horizontal rule
        if re.match(r'^([-*_])\1{2,}$', stripped):
            i += 1
            continue
        # blockquote
        if stripped.startswith('>'):
            blocks.append(para(strip_inline_md(stripped.lstrip('> ').strip()),
                               style='Quote'))
            i += 1
            continue
        # bullets
        bm = re.match(r'^\s*[-*]\s+(.*)$', line)
        if bm:
            blocks.append(para(strip_inline_md(bm.group(1)), bullet=True))
            i += 1
            continue
        nm = re.match(r'^\s*\d+\.\s+(.*)$', line)
        if nm:
            blocks.append(para(strip_inline_md(nm.group(1)), bullet=True))
            i += 1
            continue
        # plain paragraph (gather continuation lines)
        buf = [stripped]
        i += 1
        while i < n and lines[i].strip() and not re.match(
                r'^\s*([-*]\s|\d+\.\s|#{1,6}\s|>|```|\|)', lines[i]):
            buf.append(lines[i].strip())
            i += 1
        blocks.append(para(strip_inline_md(' '.join(buf))))
    return ''.join(blocks)


def strip_inline_md(s):
    # turn [text](url) into "text (url)"; leave **bold** and `code` for runs()
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', s)
    return s


DOCUMENT = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<w:document xmlns:w="http://schemas.openxmlformats.org/'
            'wordprocessingml/2006/main"><w:body>%s'
            '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1134" w:bottom="1134" w:left="1134" '
            'w:right="1134"/></w:sectPr></w:body></w:document>')

CONTENT_TYPES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
                 '<Types xmlns="http://schemas.openxmlformats.org/package/'
                 '2006/content-types">'
                 '<Default Extension="rels" ContentType="application/'
                 'vnd.openxmlformats-package.relationships+xml"/>'
                 '<Default Extension="xml" ContentType="application/xml"/>'
                 '<Override PartName="/word/document.xml" ContentType='
                 '"application/vnd.openxmlformats-officedocument.'
                 'wordprocessingml.document.main+xml"/>'
                 '<Override PartName="/word/styles.xml" ContentType='
                 '"application/vnd.openxmlformats-officedocument.'
                 'wordprocessingml.styles+xml"/>'
                 '<Override PartName="/word/numbering.xml" ContentType='
                 '"application/vnd.openxmlformats-officedocument.'
                 'wordprocessingml.numbering+xml"/></Types>')

RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/'
        '2006/relationships"><Relationship Id="rId1" Type="http://schemas.'
        'openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="word/document.xml"/></Relationships>')

DOC_RELS = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/'
            '2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/'
            'officeDocument/2006/relationships/styles" Target="styles.xml"/>'
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/'
            'officeDocument/2006/relationships/numbering" '
            'Target="numbering.xml"/></Relationships>')


def heading_style(idx, size, color):
    return ('<w:style w:type="paragraph" w:styleId="Heading%d"><w:name '
            'w:val="heading %d"/><w:basedOn w:val="Normal"/><w:pPr>'
            '<w:keepNext/><w:spacing w:before="240" w:after="80"/></w:pPr>'
            '<w:rPr><w:rFonts w:asciiTheme="majorHAnsi" '
            'w:hAnsiTheme="majorHAnsi"/><w:b/><w:color w:val="%s"/>'
            '<w:sz w:val="%d"/></w:rPr></w:style>' % (idx, idx, color, size))


STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
          '<w:styles xmlns:w="http://schemas.openxmlformats.org/'
          'wordprocessingml/2006/main">'
          '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts '
          'w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr>'
          '</w:rPrDefault></w:docDefaults>'
          '<w:style w:type="paragraph" w:default="1" w:styleId="Normal">'
          '<w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" '
          'w:line="276" w:lineRule="auto"/></w:pPr></w:style>'
          + heading_style(1, 40, '1F3864')
          + heading_style(2, 30, '2E5496')
          + heading_style(3, 26, '2E5496')
          + heading_style(4, 23, '44546A')
          + '<w:style w:type="paragraph" w:styleId="Quote"><w:name '
          'w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind '
          'w:left="360"/></w:pPr><w:rPr><w:i/><w:color w:val="555555"/>'
          '</w:rPr></w:style>'
          '<w:style w:type="paragraph" w:styleId="Code"><w:name '
          'w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd '
          'w:val="clear" w:fill="F4F4F4"/><w:spacing w:after="0" '
          'w:line="240" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts '
          'w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/></w:rPr>'
          '</w:style></w:styles>')

NUMBERING = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
             '<w:numbering xmlns:w="http://schemas.openxmlformats.org/'
             'wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0">'
             '<w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText '
             'w:val="•"/><w:pPr><w:ind w:left="360" w:hanging="360"/>'
             '</w:pPr></w:lvl></w:abstractNum>'
             '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
             '</w:numbering>')


def main():
    with open(SRC, 'r', encoding='utf-8') as f:
        md = f.read()
    body = parse(md)
    with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', CONTENT_TYPES)
        z.writestr('_rels/.rels', RELS)
        z.writestr('word/_rels/document.xml.rels', DOC_RELS)
        z.writestr('word/document.xml', DOCUMENT % body)
        z.writestr('word/styles.xml', STYLES)
        z.writestr('word/numbering.xml', NUMBERING)
    print('Wrote %s (%d bytes)' % (OUT, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
