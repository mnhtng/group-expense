import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const tooling=createRequire(require.resolve('shadcn'));
const merge=tooling('deepmerge');
test('deepmerge patch prevents target/source/nested prototype poisoning without changing ordinary merges',()=>{
  const bad=()=>JSON.parse('{"__proto__":{"poisoned":true},"safe":1}');
  for(const result of [merge(bad(),{}),merge(bad(),bad()),merge({nested:bad()},{nested:{ok:true}}).nested]){
    assert.equal(Object.getPrototypeOf(result),Object.prototype);
    assert.equal(result.poisoned,undefined);assert.equal(result.safe,1);
  }
  assert.equal({}.poisoned,undefined);
  const symbol=Symbol('metadata');
  const result=merge({items:[1],nested:{a:1},[symbol]:{x:1}},
    {items:[2],nested:{b:2},[symbol]:{y:2}});
  assert.deepEqual(result.items,[1,2]);assert.deepEqual(result.nested,{a:1,b:2});
  assert.deepEqual(result[symbol],{x:1,y:2});
  assert.deepEqual(merge({items:[1]},{items:[2]},{customMerge:key=>key==='items'?(_a,b)=>b:undefined}).items,[2]);
});
test('patched minimatch preserves the real ts-morph glob consumer and source project discovery',()=>{
  const common=createRequire(tooling.resolve('@ts-morph/common'));
  assert.equal(common('minimatch/package.json').version,'11.0.1');
  const mm=common('minimatch');
  for(const [path,pattern,wanted] of [
    ['src/a.ts','src/**/*.ts',true],['src/a.test.ts','**/!(*.test).ts',false],
    ['src/nested/a.ts','src/**/*.ts',true],['src/a.tsx','**/*.{ts,tsx}',true],
  ])assert.equal(mm.minimatch(path,pattern),wanted);
  const {Project}=tooling('ts-morph');const project=new Project({useInMemoryFileSystem:true});
  project.createSourceFile('/src/a.ts','export const a = 1;');
  project.createSourceFile('/src/nested/b.ts','export const b = 2;');
  project.createSourceFile('/other/c.ts','export const c = 3;');
  assert.deepEqual(project.getSourceFiles('/src/**/*.ts').map(f=>f.getBaseName()).sort(),['a.ts','b.ts']);
});
