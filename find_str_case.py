import re

with open('public/lib/xlsx.full.min.js', 'rb') as f:
    data = f.read()

text = data.decode('utf-8', errors='replace')

# Search for the 'case str' pattern in the minified code
# In the minified xlsx, 'str' handler has the pattern: break;case'str':
# Or: case'str':p.t="s";p.v=(p.v!=null)?utf8read(p.v):''
idx = 0
count = 0
while True:
    idx = text.find("case'str'", idx)
    if idx == -1:
        idx = text.find('case"str"', idx + 1)
        if idx == -1:
            break
    print(f'Found at {idx}:')
    print(f'  {repr(text[idx:idx+150])}')
    idx += 1
    count += 1

# Also search for utf8read
print('\nSearching for utf8read use patterns...')
idx = 0
while True:
    idx = text.find('utf8read(p.v', idx)
    if idx == -1:
        break
    print(f'utf8read(p.v at {idx}:')
    start = max(0, idx - 100)
    end = min(len(text), idx + 80)
    print(f'  {repr(text[start:end])}')
    idx += 1
