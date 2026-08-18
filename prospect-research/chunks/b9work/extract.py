import json,sys,os,re
files=sys.argv[1:]
out={}
def take(obj):
    if isinstance(obj,dict) and isinstance(obj.get('people'),list):
        for p in obj['people']:
            if isinstance(p,dict) and re.fullmatch(r'[a-f0-9]{24}',str(p.get('id',''))):
                out[p['id']]=p
        return True
    return False
def scan_text(t):
    if 'total_entries' not in t: return
    try: take(json.loads(t))
    except Exception: pass
def walk(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k=='text' and isinstance(v,str): scan_text(v)
            else: walk(v)
    elif isinstance(o,list):
        for v in o: walk(v)
    elif isinstance(o,str):
        scan_text(o)
for f in files:
    for line in open(f,encoding='utf-8',errors='replace'):
        try: d=json.loads(line)
        except Exception: continue
        walk(d)
prev=json.load(open('candidates.json')) if os.path.exists('candidates.json') else {}
n0=len(prev); prev.update(out)
json.dump(prev,open('candidates.json','w'))
print('found',len(out),'total',len(prev),'new',len(prev)-n0)
