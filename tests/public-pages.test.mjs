import test from 'node:test';
import assert from 'node:assert/strict';
import {renderPublicPage} from '../server/public-pages.mjs';
import {initialContent} from '../shared/content.mjs';
const template='<title>Initial</title><div id="root"></div>';
test('published content is readable, escaped, and drafts stay private',()=>{
 const raw=structuredClone(initialContent);
 raw.news=[{id:'visible',title:'Visible <script>',body:'Published',published:true},{id:'secret',title:'SECRET',body:'SECRET',published:false}];
 const page=renderPublicPage(template,'/news',raw);
 assert.equal(page.status,200);assert.match(page.html,/Visible &lt;script&gt;/);assert.doesNotMatch(page.html,/SECRET/);
 assert.equal(renderPublicPage(template,'/news/secret',raw).status,404);
 assert.equal(renderPublicPage(template,'/news/visible',raw).status,200);
});
test('unknown paths return 404 and administrative pages are noindex',()=>{
 assert.equal(renderPublicPage(template,'/missing',initialContent).status,404);
 assert.equal(renderPublicPage(template,'/admin',initialContent).noindex,true);
 assert.doesNotMatch(renderPublicPage(template,'/admin',initialContent).html,/canonical/);
 assert.match(renderPublicPage(template,'/',initialContent).html,/Анна Мысливцева/);
});
