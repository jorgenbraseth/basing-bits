#!/usr/bin/env python3
"""Inline src/gen.js into src/page.html -> index.html (one self-contained file)."""
from pathlib import Path
here = Path(__file__).parent
page = (here / 'src/page.html').read_text(encoding='utf-8')
gen = (here / 'src/gen.js').read_text(encoding='utf-8')
assert '</script' not in gen, 'gen.js must not contain a closing script tag'
assert '/*__GEN__*/' in page, 'placeholder missing in src/page.html'
body = page.replace('/*__GEN__*/', gen)
# page.html is written for claude.ai (which adds the document skeleton); add one for standalone use.
html = ('<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
        '<style>html,body{margin:0}body{font:14px system-ui,sans-serif}[hidden]{display:none!important}</style>\n'
        '</head>\n<body>\n' + body + '\n</body>\n</html>\n')
(here / 'index.html').write_text(html, encoding='utf-8')
print(f'wrote index.html ({len(html)//1024} KB)')
