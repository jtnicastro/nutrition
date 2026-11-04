"""Maintenance helper for Nutrition.

  python3 tools/build.py sw    # refresh sw.js (cache version + asset list)

Run it after changing any shipped file so installed phones pick up the update
(the app then shows "A new version is ready").
"""
import hashlib, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def sw():
    assets = ['./', 'index.html', 'app.js', 'app.css', 'seed.json', 'manifest.webmanifest', 'fonts/fonts.css']
    assets += ['fonts/' + f for f in sorted(os.listdir(os.path.join(ROOT, 'fonts'))) if f.endswith('.woff2')]
    assets += ['icons/' + f for f in sorted(os.listdir(os.path.join(ROOT, 'icons')))]
    h = hashlib.sha256()
    for a in assets[1:]:
        h.update(open(os.path.join(ROOT, a), 'rb').read())
    version = 'nutrition-' + h.hexdigest()[:10]
    path = os.path.join(ROOT, 'sw.js')
    src = open(path).read()
    src = re.sub(r"const VERSION = '[^']*';", "const VERSION = '%s';" % version, src)
    src = re.sub(r"const ASSETS = \[.*?\];", 'const ASSETS = %s;' % json.dumps(assets), src, flags=re.S)
    open(path, 'w').write(src)
    print('sw.js version', version)


if __name__ == '__main__':
    if sys.argv[1:] == ['sw']:
        sw()
    else:
        print(__doc__)
