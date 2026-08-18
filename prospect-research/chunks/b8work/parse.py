import json,glob,os,re
SP='/sessions/wizardly-eloquent-maxwell/mnt/.claude/projects/C--Users-tulasi-konathala-AppData-Roaming-Claude-local-agent-mode-sessions-7498d081-3dd6-4a49-b308-5a18b94a20e2-3e229580-49a8-4f0e-8e19-a321e5b01936-local-04dc645c-6168-4471-b546-6427384e8d47-outputs/1b2c91ca-a09b-4e62-a4d1-8c9d07b61772/tool-results'
CUT=1786997304012
sel={x['id'] for x in json.load(open('_final.json'))}
out='enriched.jsonl'
recs={}
if os.path.exists(out):
    for l in open(out):
        l=l.strip()
        if l:
            r=json.loads(l); recs[r['person_apollo_id']]=r
def payloads():
    for f in glob.glob(SP+'/*apollo_people_bulk_match*'):
        m=re.search(r'-(\d{13})\.txt$',f)
        if m and int(m.group(1))>=CUT:
            raw=open(f,encoding='utf-8',errors='replace').read()
            yield f, raw[raw.find('{'):]
    for f in glob.glob(SP+'/toolu_*.json'):
        if os.path.getmtime(f) < 1786997000: continue
        try: arr=json.load(open(f,encoding='utf-8',errors='replace'))
        except: continue
        if isinstance(arr,list):
            for it in arr:
                t=it.get('text','')
                if '"matches"' in t: yield f, t
consumed=0; nf=0
for f,txt in payloads():
    try: d=json.loads(txt)
    except Exception as e: print('SKIP',os.path.basename(f),e); continue
    if 'matches' not in d: continue
    nf+=1
    consumed+=d.get('credits_consumed') or 0
    for p in (d.get('matches') or []):
        if not p or not p.get('id') or p['id'] not in sel: continue
        o=p.get('organization') or {}
        recs[p['id']]={
         'person_apollo_id':p.get('id'),'first_name':p.get('first_name') or '','last_name':p.get('last_name') or '',
         'title':p.get('title') or '','company_name':o.get('name') or '','apollo_org_id':o.get('id') or p.get('organization_id') or '',
         'company_domain':o.get('primary_domain') or '','industry':o.get('industry') or '',
         'organization_revenue':o.get('organization_revenue') or '','employee_count':o.get('estimated_num_employees') or '',
         'country':p.get('country') or o.get('country') or '','city':o.get('city') or '','state':o.get('state') or '',
         'email':p.get('email') or '','email_status':p.get('email_status') or '','linkedin_url':p.get('linkedin_url') or '',
         'seniority_hint':p.get('seniority') or ''}
with open(out,'w') as fh:
    for r in recs.values(): fh.write(json.dumps(r)+'\n')
print('payloads',nf,'records',len(recs),'credits',consumed)
missing=sel-set(recs)
print('still to enrich',len(missing))
ml=sorted(missing)
for i in range(0,len(ml),10): print(json.dumps([{'id':x} for x in ml[i:i+10]]))
