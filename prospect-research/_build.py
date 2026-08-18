import csv, glob, os, re, json
BATCH = {'_raw_b1.psv':1,'_raw_b1p2.psv':1,'_raw_b2.psv':2,'_raw_b2p2.psv':2,'_raw_b3.psv':3,
         '_raw_b4.psv':4,'_raw_b4p2.psv':4,'_raw_b5.psv':5,'_raw_b6.psv':6,'_raw_b7.psv':7,'_raw_b8.psv':8}
order = ['_raw_b1.psv','_raw_b1p2.psv','_raw_b2.psv','_raw_b2p2.psv','_raw_b3.psv','_raw_b4.psv','_raw_b4p2.psv',
         '_raw_b5.psv','_raw_b6.psv','_raw_b7.psv','_raw_b8.psv']

rows=[]
for f in order:
    for line in open(f, encoding='utf-8'):
        line=line.rstrip('\n').strip()
        if not line: continue
        p=(line.split('|')+['']*9)[:9]
        rows.append(dict(oid=p[0].strip(),name=p[1].strip(),domain=p[2].strip(),naics=p[3].strip(),
                         rev=p[4].strip(),owner=p[5].strip(),city=p[6].strip(),state=p[7].strip(),
                         country=p[8].strip(),batch=BATCH[f]))
raw_total=len(rows)

# ---------------- exclusions ----------------
CARRIER_RE = re.compile(r'\b(logistics|freight|trucking|carrier|forwarding|shipping line|3pl|last mile|'
                        r'drayage|intermodal|courier|parcel service|transport(ation)?)\b', re.I)
EX_CARRIER = {'Pitney Bowes','Gopuff','Instacart'}
EX_SOFTWARE = {'Motive','Geotab','QAD','Valve corporation','Synopsys Inc','Cadence','Altium','Argo AI',
               'Flock','Verily Health','Faire','Cox Automotive Inc.','Cox Enterprises','Magic Leap',
               'Hitachi Vantara','Hitachi Data Systems'}
EX_SERVICES = {'Brightstar Corp.','FlightSafety International','Clario','US Pharmacopeia','Vizient',
               'Hinge Health','Rent The Runway','Soho House & Co'}
EX_NONNA = {'Temu','Coupang','HUGO BOSS','Corporacion El Rosado S.A.','Abdul Latif Jameel',
            'Elbit Systems Israel','BGI Genomics','Epson Latinoamerica','ICL Group','SQM Litio',
            'Robertet Group','Orbia','Grupo Unicomer / Unicomer Group','Specsavers','Wish',
            'Anker Innovations','Geek+','Hai Robotics','Thermax Limited','HORSCH','Wittur Group',
            'Toshiba','NSK','Takata','Yanfeng','Godiva Chocolatier','Beam Suntory','Theory',
            'Suntory Global Spirits','Piramal Pharma Solutions','Joyson Safety Systems'}
# stale / renamed / absorbed brand duplicates of a company already kept
EX_VARIANT = {'TD SYNNEX North America':'TD SYNNEX','World Fuel':'World Kinect','AmerisourceBergen':'Cencora',
              'NCR Corporation':'NCR Voyix','Vinmar Group':'Vinmar International','CVS Pharmacy':'CVS Health',
              'Walgreens Boots Alliance':'Walgreens','L Brands':'Bath & Body Works','Raytheon':'RTX',
              'Rockwell Collins':'Collins Aerospace','UTC Aerospace Systems':'Collins Aerospace',
              'General Atomics Aeronautical Systems':'General Atomics','B/E Aerospace':'Collins Aerospace',
              'Beacon Building Products':'QXO','PerkinElmer':'Revvity','Everpure':'Pure Storage',
              'Life Technologies':'Thermo Fisher Scientific','Oculus VR':'Meta','Polycom':'Poly',
              'Maxim Integrated':'Analog Devices','Hospira':'ICU Medical','Delphi':'BorgWarner',
              'Aerojet Rocketdyne':'L3Harris Technologies','Covidien (Medtronic Minimally Invasive Therapies Group)':'Medtronic',
              'The Janssen Pharmaceutical Companies of Johnson & Johnson':'Johnson & Johnson',
              'MSD':'Merck','Ingersoll Rand Compressor Systems & Services':'Ingersoll Rand',
              'Carrier HVAC':'Carrier','Chevrolet':'General Motors','Cadillac':'General Motors','GMC':'General Motors',
              'Jeep':'Stellantis','DRiV':'Tenneco','Gardner Denver':'Ingersoll Rand','Milacron':'Hillenbrand',
              'DEWALT':'Stanley Black & Decker, Inc.','Genie':'Terex Corporation','Kenworth Truck Co.':'PACCAR',
              'Athleta':'Gap Inc.','Madewell':'J.Crew','Safeway':'Albertsons Companies','Bloomingdale\'s':"Macy's",
              'Trane':'Trane Technologies','Amazon Lab126':'Amazon','Honda of America Mfg., Inc.':'American Honda Motor Company, Inc.',
              'Textron Aviation':'Textron','GE Vernova':'GE','Rivian and Volkswagen Group Technologies':'Rivian',
              'BMW Manufacturing Co., LLC':'BMW Group US','Oshkosh Defense':'Oshkosh Corporation',
              'Motorola Mobility (a Lenovo Company)':'Lenovo','NCR Atleos':'NCR Voyix','VWR, part of Avantor':'Avantor',
              'Kimberly-Clark Professional':'Kimberly-Clark','Performance Foodservice':'Performance Food Group',
              'Motion':'NAPA Auto Parts','HPE Aruba Networking':'Hewlett Packard Enterprise',
              'RUCKUS Networks':'Belden Inc.','Sandisk':'Western Digital','Silicon Labs':'Texas Instruments',
              'GE Aerospace':'GE','Pratt & Whitney':'RTX','General Dynamics Mission Systems':'General Dynamics',
              'Gulfstream Aerospace':'General Dynamics','Guardian Industries':'Koch','Spirit AeroSystems':'Boeing',
              'Honda Aircraft Company':'American Honda Motor Company, Inc.','The Home Depot Canada':'The Home Depot',
              'Johnson & Johnson MedTech':'Johnson & Johnson','DePuy Synthes':'Johnson & Johnson',
              'Ethicon, Inc.':'Johnson & Johnson','Johnson & Johnson Vision':'Johnson & Johnson'}

reasons={}
ALLOW={'Carrier','Harbor Freight Tools','Wabtec Corporation','Bendix Commercial Vehicle Systems LLC'}
def why(r):
    n=r['name']
    if n in EX_CARRIER: return 'carrier/3PL/logistics'
    if n not in ALLOW and CARRIER_RE.search(n): return 'carrier/3PL/logistics'
    if n in EX_SOFTWARE: return 'software/SaaS'
    if n in EX_SERVICES: return 'services/staffing/nonprofit/health-services'
    if n in EX_NONNA: return 'non-US/CA HQ'
    if n in EX_VARIANT: return 'name variant / subsidiary of kept parent'
    return None

kept={}; excluded=[]
for r in rows:
    w=why(r)
    if w: excluded.append((r['name'],w)); reasons[w]=reasons.get(w,0)+1; continue
    if r['oid'] in kept:
        continue   # dedupe on apollo_org_id, keep first (lowest batch)
    kept[r['oid']]=r
dupes = raw_total - len(excluded) - len(kept)

CA_NAMES={'Loblaw Companies Limited','Sobeys','Metro Inc.','Canadian Tire Corporation','Aritzia','Canada Goose',
 'ALDO Group','SSENSE','Indigo','Magna International','Linamar Corporation','Martinrea International',
 'ATS Corporation','Celestica','Bombardier','MDA Space','Magellan Aerospace Limited','CAE','EXFO','Evertz',
 'Mitel','Calian Group','New Flyer','LION','Toyota Motor Manufacturing Canada','Honda Canada Inc.',
 'Walmart Canada','Shoppers Drug Mart','Jamieson Wellness Inc.','McCain Foods','Apotex Inc.','Finning',
 'IPEX by Aliaxis','Global Furniture Group','Litens Automotive Group','Multimatic','Husky Technologies',
 'Armstrong Fluid Technology','AGI - Ag Growth International','Anatolia','Tilray Brands, Inc.',
 'Canadian Solar Inc.','Ceragon Networks','Arc\'teryx Equipment','Future Electronics','Nuro','ABC Technologies',
 'Molson Coors Beverage Company','Trulieve','Cresco Labs','Suncor'}
def country(r):
    if r['country']: return r['country']
    if r['domain'].endswith('.ca'): return 'Canada'
    if r['name'] in CA_NAMES: return 'Canada'
    return 'United States'

out=[]
for r in kept.values():
    out.append({'apollo_org_id':r['oid'],'company_name':r['name'],'primary_domain':r['domain'],
        'website_url':('https://'+r['domain']) if r['domain'] else '',
        'naics_primary':r['naics'],'industry':'','estimated_revenue':r['rev'],'employee_count':'',
        'hq_city':r['city'],'hq_state':r['state'],'hq_country':country(r),
        'owned_by_organization_name':r['owner'],'vertical_batch':r['batch']})
out.sort(key=lambda x:(x['vertical_batch'], x['company_name'].lower()))
cols=['apollo_org_id','company_name','primary_domain','website_url','naics_primary','industry',
      'estimated_revenue','employee_count','hq_city','hq_state','hq_country',
      'owned_by_organization_name','vertical_batch']
with open('01_account_universe.csv','w',newline='',encoding='utf-8') as fh:
    w=csv.DictWriter(fh,fieldnames=cols); w.writeheader(); w.writerows(out)

from collections import Counter
print('raw rows            :',raw_total)
print('excluded            :',len(excluded))
for k,v in sorted(reasons.items(), key=lambda x:-x[1]): print('   ',k,':',v)
print('cross-batch dupes   :',dupes)
print('final unique        :',len(out))
print('per vertical        :',dict(sorted(Counter(x['vertical_batch'] for x in out).items())))
print('country             :',dict(Counter(x['hq_country'] for x in out)))
print('missing domain      :',sum(1 for x in out if not x['primary_domain']))
