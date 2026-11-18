"""Builds dist/seo-page-to-ai-chrome-<version>.zip for the Chrome Web Store (extension files only)."""
import json, os, zipfile
os.chdir(os.path.dirname(os.path.abspath(__file__)))
v = json.load(open('manifest.json'))['version']
files = ['manifest.json', 'background.js', 'extract.js', 'format.js', 'popup.html', 'popup.js', 'icon16.png', 'icon32.png', 'icon48.png', 'icon128.png']
os.makedirs('dist', exist_ok=True)
out = f'dist/seo-page-to-ai-chrome-{v}.zip'
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in files:
        z.write(f)
print('BUILT', out, os.path.getsize(out), 'bytes')
