import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
const ddl=readFileSync(new URL('../drizzle/0000_whole_lady_deathstrike.sql',import.meta.url),'utf8');
const api=readFileSync(new URL('../app/api/[...path]/route.ts',import.meta.url),'utf8');
const snapshotSql=api.match(/const sql=`(INSERT INTO snapshots[^`]+)`/)[1];
function fixture(){const db=new DatabaseSync(':memory:');db.exec(ddl);db.exec("ALTER TABLE medications ADD COLUMN list_state text DEFAULT 'active' NOT NULL");db.prepare('INSERT INTO profiles VALUES (?,?,?,?)').run('p','owner','Demo','now');db.prepare('INSERT INTO profiles VALUES (?,?,?,?)').run('p-other','other','Other','now');return db;}
function insert(db,id='m',revision=1,confirmed=1,owner='owner',profile='p'){db.prepare('INSERT INTO medications (id,owner_id,profile_id,data,source_ids,revision,confirmed_revision,confirmed_at,list_state,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(id,owner,profile,'{}','[]',revision,confirmed,confirmed===null?null:'now','active','now','now');}
function snapshot(db,expected=[{id:'m',revision:1}],owner='owner',profile='p',key='request'){return db.prepare(snapshotSql).run('snapshot-'+key,owner,profile,'Demo clinic','Fictional','{}',key,'now',owner,profile,expected.length,owner,profile,JSON.stringify(expected));}
test('snapshot insertion succeeds only for the exact confirmed list',()=>{const db=fixture();insert(db);assert.equal(snapshot(db).changes,1);db.close();});
test('unconfirmed entries are rejected by the database gate',()=>{const db=fixture();insert(db,'m',1,null);assert.equal(snapshot(db).changes,0);db.close();});
test('a stale confirmation is rejected by the database gate',()=>{const db=fixture();insert(db,'m',2,1);assert.equal(snapshot(db,[{id:'m',revision:2}]).changes,0);db.close();});
test('a concurrently edited and re-confirmed entry invalidates the old snapshot request',()=>{const db=fixture();insert(db,'m',2,2);assert.equal(snapshot(db,[{id:'m',revision:1}]).changes,0);db.close();});
test('a medication added after the initial read invalidates the old snapshot request',()=>{const db=fixture();insert(db);insert(db,'new');assert.equal(snapshot(db).changes,0);db.close();});
test('replacement by a different confirmed entry is detected despite equal count',()=>{const db=fixture();insert(db,'replacement');assert.equal(snapshot(db).changes,0);db.close();});
test('another owner cannot use a confirmed list to create their snapshot',()=>{const db=fixture();insert(db);assert.equal(snapshot(db,[{id:'m',revision:1}],'other','p-other').changes,0);db.close();});
test('card request keys are unique per owner',()=>{const db=fixture();insert(db);assert.equal(snapshot(db).changes,1);assert.throws(()=>snapshot(db));db.close();});
test('editing clears the confirmation and rejects an outdated editor revision',()=>{const db=fixture();insert(db);const update=db.prepare('UPDATE medications SET revision=revision+1,confirmed_revision=NULL,confirmed_at=NULL WHERE id=? AND owner_id=? AND revision=?');assert.equal(update.run('m','owner',1).changes,1);assert.equal(update.run('m','owner',1).changes,0);assert.equal(snapshot(db,[{id:'m',revision:2}]).changes,0);db.close();});
test('a 100-entry list uses a bounded JSON parameter instead of exceeding parameter limits',()=>{const db=fixture();const expected=[];for(let i=0;i<100;i++){insert(db,'m'+i);expected.push({id:'m'+i,revision:1});}assert.equal(snapshot(db,expected).changes,1);db.close();});
