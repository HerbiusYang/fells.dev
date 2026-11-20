import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { buildProvenance, buildSourceIdentity } from '../scripts/build-provenance.mjs';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'fells-provenance-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  await writeFile(join(root,'.gitignore'),'dist/\n');await writeFile(join(root,'pnpm-lock.yaml'),'synthetic-lock\n');await writeFile(join(root,'source.txt'),'first revision\n');
  git('init','-q');git('add','.');git('-c','user.name=Synthetic test','-c','user.email=test@example.invalid','commit','-qm','synthetic source');
  const dist=join(root,'dist');await mkdir(dist);await writeFile(join(dist,'index.html'),'<!doctype html>');
  for(const prefix of ['','zh/','zh-hant/','ja/','ko/','es/'])for(const suffix of ['','desk/']){const dir=join(dist,prefix+'support/'+suffix);await mkdir(dir,{recursive:true});await writeFile(join(dir,'index.html'),'<meta name="robots" content="noindex, nofollow, noarchive">');}
  const integration=buildProvenance(),dir=pathToFileURL(dist+'/');integration.hooks['astro:config:done']({config:{root:pathToFileURL(root+'/')}});
  const build=()=>{integration.hooks['astro:build:start']();integration.hooks['astro:build:done']({dir});};
  return{root,dist,git,build,integration,dir};
}
test('a build records its exact source and packaging rejects stale output after a new commit',async t=>{
  const f=await fixture(t);f.build();
  const identity=JSON.parse(await readFile(join(f.dist,'frontend-source.json'),'utf8'));
  assert.equal(identity.sourceDirty,false);assert.equal(identity.sourceCommit,f.git('rev-parse','HEAD'));assert.match(identity.sourceHash,/^[a-f0-9]{64}$/);
  const output=await mkdtemp(join(tmpdir(),'fells-package-'));t.after(()=>rm(output,{recursive:true,force:true}));
  const pack=()=>spawnSync('python3',[resolve('scripts/release-artifact.py'),'--dist',f.dist,'--out',output],{cwd:f.root,encoding:'utf8',env:{...process.env,SUPPORT_PORTAL_PATH:''}});
  const first=pack();assert.equal(first.status,0,first.stderr);
  const proof=JSON.parse(await readFile(join(output,'frontend-build-proof.json'),'utf8'));assert.equal(proof.buildSourceHash,identity.sourceHash);
  await writeFile(join(f.root,'source.txt'),'second revision\n');f.git('add','source.txt');f.git('-c','user.name=Synthetic test','-c','user.email=test@example.invalid','commit','-qm','second synthetic revision');
  const stale=pack();assert.notEqual(stale.status,0);assert.match(stale.stderr,/does not match/);
  f.build();assert.equal(pack().status,0);
  const stamp=join(f.dist,'frontend-source.json');await writeFile(stamp,JSON.stringify({...buildSourceIdentity(f.root),sourceHash:'0'.repeat(64)}));assert.match(pack().stderr,/does not match/);
  await unlink(stamp);assert.match(pack().stderr,/provenance is missing/);
});
test('builds refuse source mutation during compilation and record an unchanged dirty snapshot honestly',async t=>{
  const f=await fixture(t);f.integration.hooks['astro:build:start']();await writeFile(join(f.root,'source.txt'),'changed while compiling');
  assert.throws(()=>f.integration.hooks['astro:build:done']({dir:f.dir}),/Source changed during build/);
  f.build();assert.equal(JSON.parse(await readFile(join(f.dist,'frontend-source.json'),'utf8')).sourceDirty,true);
  const before=buildSourceIdentity(f.root).sourceHash;await writeFile(join(f.root,'untracked.txt'),'included change');assert.notEqual(buildSourceIdentity(f.root).sourceHash,before);
  await symlink('source.txt',join(f.root,'source-link'));const linked=buildSourceIdentity(f.root).sourceHash;await unlink(join(f.root,'source.txt'));assert.notEqual(buildSourceIdentity(f.root).sourceHash,linked);
});
