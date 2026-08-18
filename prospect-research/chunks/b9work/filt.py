import json,csv,re,collections,unicodedata
cand=json.load(open('candidates.json'))
qa=list(csv.DictReader(open('../../04_qa1.csv')))
uni=list(csv.DictReader(open('../../01_account_universe.csv')))
def norm(s):
    s=unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower()
    s=re.sub(r'\b(inc|llc|ltd|corp|corporation|company|co|companies|the|plc|group|holdings|international|limited)\b','',s)
    return re.sub(r'[^a-z0-9]','',s)
uni_by_name={}
for r in uni:
    uni_by_name.setdefault(norm(r['company_name']),r)
qa_ids={r['person_apollo_id'] for r in qa}
cnt_by_org=collections.Counter(r['apollo_org_id'] for r in qa)
cnt_by_name=collections.Counter(norm(r['company_name']) for r in qa)

ANCHOR=r'(supply\s*chain|logistic|transportation|distribution|fulfil|warehouse|operations|manufactur|\bscm\b|\berp\b|\bwms\b|\btms\b|s&op|planning|inventory|procure to pay|order management|\bmake\b|\bdeliver\b)'
P6=r'(enterprise architect|enterprise application|business application|\berp\b|\bsap\b|\bs4\b|s/4|oracle|business system|solution architect|application architect|enterprise system|data architect|technical architect|integration architect)'
P2=r'(system|technolog|application|\bit\b|analytic|\bdata\b|architect|platform|software|engineering|solution|digital enablement|product management|\bai\b|automation|\bdigital\b)'
P1=r'(transformation|digital|excellence|strategy|innovation|optimi|moderni|continuous improvement|process improvement|center of excellence|\bcoe\b)'
DROP=r'(procurement|sourcing|purchasing|buyer|category management|\bfinance|financial|controller|treasur|\bhr\b|human resource|talent|legal|counsel|marketing|\bsales\b|account manag|business development|customer success|commercial|merchandis|clinical|medical affairs|patient|regulatory|\bquality\b|compliance|validation|cyber|security|infosec|privacy|audit|facilities|real estate|environmental|sustainab|safety|labor relations|communications|investor)'
kept=[]; drops=collections.Counter(); dropped_titles=collections.defaultdict(list)
for pid,p in cand.items():
    t=(p.get('title') or '')
    tl=t.lower()
    org=(p.get('organization') or {}).get('name','')
    on=norm(org)
    if pid in qa_ids: drops['already_in_qa1']+=1; continue
    lr=p.get('last_refreshed_at') or ''
    if lr < '2025-08-17': drops['stale_refresh']+=1; continue
    if re.search(DROP,tl): drops['excluded_remit']+=1; dropped_titles['remit'].append((t,org)); continue
    if not re.search(ANCHOR,tl): drops['no_sc_anchor']+=1; dropped_titles['anchor'].append((t,org)); continue
    if re.search(P6,tl): persona='P6'
    elif re.search(P2,tl): persona='P2'
    elif re.search(P1,tl): persona='P1'
    else: drops['not_p1p2p6']+=1; dropped_titles['persona'].append((t,org)); continue
    # P1 override: transformation/digital-led titles without hard systems words
    if persona=='P2' and re.search(r'(transformation|excellence|innovation|optimi|moderni)',tl) and not re.search(r'(system|technolog|application|\bit\b|analytic|architect|platform|software|engineering|\bdata\b)',tl):
        persona='P1'
    kept.append(dict(pid=pid,title=t,org=org,on=on,persona=persona,has_email=p.get('has_email'),lr=lr,fn=p.get('first_name')))
print('candidates',len(cand))
for k,v in drops.most_common(): print('DROP',k,v)
print('kept_pre_cap',len(kept))
print('persona',collections.Counter(k['persona'] for k in kept))
# org mapping
unmapped=collections.Counter()
for k in kept:
    r=uni_by_name.get(k['on'])
    k['org_id']=r['apollo_org_id'] if r else ''
    if not r: unmapped[k['org']]+=1
print('unmapped_orgs',len(unmapped),sum(unmapped.values()))
print(list(unmapped.items())[:25])
json.dump(kept,open('kept.json','w'))
json.dump({k:v[:60] for k,v in dropped_titles.items()},open('dropped_titles.json','w'))
