"""Schema and cross-object consistency validator for PWA-IDP-Studio v2.0.0."""
import argparse, json, pathlib, sys
from collections import Counter
from jsonschema import Draft202012Validator, FormatChecker
ROOT=pathlib.Path(__file__).parent

def validate(data, schema):
 errors=[]
 for err in Draft202012Validator(schema,format_checker=FormatChecker()).iter_errors(data):
  errors.append('SCHEMA: '+('/'.join(map(str,err.path)) or '/')+': '+err.message)
 if errors:return errors
 files={x['file_id']:x for x in data['source_files']}
 fileids=[x['file_id'] for x in data['source_files']]
 if len(fileids)!=len(set(fileids)):errors.append('DUPLICATE_FILE_ID')
 pages={(p['file_id'],p['page_number']):p for p in data['pages']}
 if len(pages)!=len(data['pages']):errors.append('DUPLICATE_PAGE')
 for f in files.values():
  actual={p for fid,p in pages if fid==f['file_id']}
  if actual!=set(range(1,f['page_count']+1)):errors.append('PAGE_MANIFEST_COVERAGE '+f['file_id'])
 regions={}
 for page in data['pages']:
  if page['file_id'] not in files or page['page_number']>files.get(page['file_id'],{}).get('page_count',0):errors.append('UNKNOWN_PAGE_SOURCE')
  if not page['regions'] and page['unassigned_reason'] is None:errors.append('UNEXPLAINED_UNASSIGNED_PAGE')
  for r in page['regions']:
   k=(page['file_id'],page['page_number'],r['region_id'])
   if k in regions:errors.append('DUPLICATE_REGION')
   regions[k]=r
   box=r['bbox']
   if box['x']+box['width']>1.000001 or box['y']+box['height']>1.000001:errors.append('REGION_BBOX_OUT_OF_RANGE')
 # Region overlap is not always wrong (shared pages/attachments), review instead of universally rejecting.
 docs={x['document_id']:x for x in data['documents']}
 txs={x['transaction_id']:x for x in data['transactions']}
 evs={x['evidence_id']:x for x in data['evidence']}
 if len(docs)!=len(data['documents']):errors.append('DUPLICATE_DOCUMENT_ID')
 if len(txs)!=len(data['transactions']):errors.append('DUPLICATE_TRANSACTION_ID')
 if len(evs)!=len(data['evidence']):errors.append('DUPLICATE_EVIDENCE_ID')
 for document in data['documents']:
  for r in document['page_refs']:
   key=(r['file_id'],r['page_number'],r['region_id'])
   if key not in regions or regions[key]['document_id']!=document['document_id']:errors.append('INVALID_DOCUMENT_PAGE_REF '+document['document_id'])
  for t in document['transaction_ids']:
   if t not in txs or txs[t]['document_id']!=document['document_id']:errors.append('INVALID_DOCUMENT_TRANSACTION_REF '+document['document_id'])
 for transaction in data['transactions']:
  doc=docs.get(transaction['document_id'])
  if not doc or transaction['transaction_id'] not in doc['transaction_ids']:errors.append('ORPHAN_TRANSACTION '+transaction['transaction_id'])
  for pointer,ids in transaction['field_evidence'].items():
   for eid in ids:
    ev=evs.get(eid)
    if not ev or ev['transaction_id']!=transaction['transaction_id'] or ev['field_pointer']!=pointer:errors.append('INVALID_FIELD_EVIDENCE '+eid)
 for ev in data['evidence']:
  tx=txs.get(ev['transaction_id']);doc=docs.get(ev['document_id'])
  if not tx or not doc or tx['document_id']!=doc['document_id']:errors.append('ORPHAN_EVIDENCE '+ev['evidence_id']);continue
  allowed={(x['file_id'],x['page_number']) for x in doc['page_refs']}
  for src in ev['sources']:
   if (src['file_id'],src['page_number']) not in allowed:errors.append('EVIDENCE_SOURCE_OUTSIDE_DOCUMENT '+ev['evidence_id'])
   b=src['bbox']
   if b['x']+b['width']>1.000001 or b['y']+b['height']>1.000001:errors.append('EVIDENCE_BBOX_OUT_OF_RANGE')
 for issue in data['issues']:
  if issue['scope']=='document' and issue['target_id'] not in docs:errors.append('ORPHAN_ISSUE')
  if issue['scope']=='transaction' and issue['target_id'] not in txs:errors.append('ORPHAN_ISSUE')
 blocking=[i for i in data['issues'] if i['status']=='open' and i['severity']=='blocking']
 for tid in data['validation']['export_eligible_transaction_ids']:
  tx=txs.get(tid)
  if not tx or tx['status'] not in ['validated','approved']:errors.append('INELIGIBLE_TRANSACTION '+tid);continue
  if docs[tx['document_id']]['boundary_status']!='confirmed':errors.append('UNCONFIRMED_BOUNDARY '+tid)
  if any((i['scope']=='batch' or (i['scope']=='document' and i['target_id']==tx['document_id']) or (i['scope']=='transaction' and i['target_id']==tid)) for i in blocking):errors.append('BLOCKING_ISSUE '+tid)
 return errors

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('instance',type=pathlib.Path);args=parser.parse_args()
 data=json.loads(args.instance.read_text());s=json.loads((ROOT/'batch-v2.0.0.schema.json').read_text());errors=validate(data,s)
 if errors:
  print('\n'.join(errors));sys.exit(1)
 print('PASS: JSON Schema + referential/coverage/export consistency')
