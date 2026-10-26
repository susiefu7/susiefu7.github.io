#!/bin/bash
# Regenerates the .docx test fixtures with three different producers.
# Requires python-docx, pandoc and LibreOffice. The fixtures are committed, so this
# only needs to run if they change.
set -euo pipefail
cd "$(dirname "$0")"

python3 - <<'PY'
from docx import Document
d = Document()
d.add_heading('The Crossing', level=1)
p = d.add_paragraph('The ferry came in under a ')
p.add_run('low').italic = True
p.add_run(' sky, and ')
p.add_run('Iris').bold = True
p.add_run(' stood at the rail.')
d.add_paragraph('')  # spacing paragraph, should be dropped
p = d.add_paragraph()
r = p.add_run('Both at once'); r.bold = True; r.italic = True
p.add_run(' — then “quoted” & <angled> text, café.')
d.add_paragraph('* * *')
d.add_heading('At the harbour', level=2)
d.add_paragraph('A list item', style='List Bullet')
p = d.add_paragraph('Line one')
p.add_run().add_break()
p.add_run('line two\tafter a tab.')
d.save('python-docx.docx')
PY

cat > /tmp/fixture.md <<'MD'
# A Pandoc Chapter

Pandoc wrote *this* paragraph with **bold** text.

Second paragraph.
MD
pandoc /tmp/fixture.md -o pandoc.docx

cat > /tmp/fixture.html <<'HTML'
<html><body>
<h1>LibreOffice Chapter</h1>
<p>Written by <i>LibreOffice</i> Writer, with <b>bold</b>.</p>
<p></p>
<p>Final paragraph.</p>
</body></html>
HTML
soffice --headless --convert-to docx:"MS Word 2007 XML" --outdir . /tmp/fixture.html >/dev/null 2>&1
mv fixture.docx libreoffice.docx
ls -la *.docx
