import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFile } from "node:fs/promises";
import { loadComponent } from "./load-contact-component.mjs";
import { contentSchema, initialContent } from "../shared/content.mjs";
const { PhoneCircleLink } = loadComponent("PhoneCircleLink.jsx");
const { OfficeDirections } = loadComponent("OfficeDirections.jsx");
const { ContactChoiceDialog } = loadComponent("ContactChoiceDialog.jsx");
const render = (component, props) => renderToStaticMarkup(React.createElement(component, props));
test("phone circle is a named direct tel link without visible label or dialog interception", () => {
 const html = render(PhoneCircleLink, { phone: "+79085023853" });
 assert.match(html, /href="tel:\+79085023853"/);
 assert.match(html, /aria-label="Позвонить Анне"/);
 assert.doesNotMatch(html.replace(/<[^>]*>/g, ""), /Позвонить/);
 assert.equal(render(PhoneCircleLink, { phone: "" }), "");
});
test("SSR and no-dialog environments retain real contact fallback", () => {
 assert.match(render(ContactChoiceDialog, { phone: "+79085023853" }), /href="\/contact">Связаться/);
});
test("office rendering never uses legacy city or map and hides dead route buttons", () => {
 assert.equal(render(OfficeDirections, { address: "Ростов-на-Дону", directionsUrl: "https://yandex.ru/maps/" }), "");
 assert.doesNotMatch(render(OfficeDirections, { officeAddress: "Тестовый кабинет", directionsUrl: "http://example.org" }), /<a/);
 assert.match(render(OfficeDirections, { officeAddress: "Тестовый кабинет", directionsUrl: "https://example.org/map" }), /noopener noreferrer/);
});
test("CMS accepts new address, preserves legacy data and supports clearing and old documents", () => {
 const old = structuredClone(initialContent);
 delete old.profile.officeAddress; delete old.profile.directionsUrl;
 old.profile.address = "Ростов-на-Дону. Выезд на дом"; old.profile.mapUrl = "https://example.org/legacy";
 const parsed = contentSchema.parse(old);
 assert.equal(parsed.profile.officeAddress, "");
 parsed.profile.officeAddress = "Тестовый кабинет"; parsed.profile.directionsUrl = "https://example.org/map";
 const saved = contentSchema.parse(JSON.parse(JSON.stringify(parsed)));
 assert.equal(saved.profile.officeAddress, "Тестовый кабинет");
 assert.equal(saved.profile.address, old.profile.address); assert.equal(saved.profile.mapUrl, old.profile.mapUrl);
 saved.profile.officeAddress = ""; saved.profile.directionsUrl = "";
 assert.equal(contentSchema.parse(saved).profile.directionsUrl, "");
 for (const url of ["http://example.org", "javascript:alert(1)", "https://user:secret@example.org", "https://example.org:8080"]) {
  saved.profile.directionsUrl = url; assert.equal(contentSchema.safeParse(saved).success, false);
 }
});
test("CMS and app wire separate fields while retaining callback, Booking, socials and routes", async () => {
 const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
 const admin = await readFile(new URL("../src/Admin.jsx", import.meta.url), "utf8");
 assert.match(app, /officeAddress=\{p.officeAddress\} directionsUrl=\{p.directionsUrl\}/);
 assert.match(admin, /\["officeAddress",/); assert.match(admin, /\["directionsUrl",/);
 assert.match(app, /<CallbackForm profile=\{p\} \/>/);
 assert.doesNotMatch(app.slice(app.indexOf("function Contact()"), app.indexOf("function CallbackConsentPage()")), /<Booking/);
 assert.match(app, /<SocialLinks profile=\{p\}/);
 assert.doesNotMatch(app, /safePublicUrl\(p.mapUrl\)/);
});
test("hero image selection preserves explicit CMS media and all original media files", async () => {
 const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
 assert.match(app, /p.heroPortrait \|\| \(custom \? p.portrait/);
 const data = contentSchema.parse(initialContent);
 data.profile.heroPortrait = "/media/synthetic-hero.png";
 assert.equal(contentSchema.parse(data).profile.heroPortrait, "/media/synthetic-hero.png");
 assert.equal(contentSchema.safeParse({...data, profile:{...data.profile, heroPortrait:"https://outside.test/image.png"}}).success, false);
 assert.match(app, /document.addEventListener\("anna:dialog-scroll-lock", sync\)/);
 assert.match(app, /menu \|\| isDocumentScrollLocked\(document\)/);
});
test("draft and incomplete consent are never public; complete published fields remain exact", async () => {
 const { publicContent } = await import("../shared/content.mjs");
 const data = contentSchema.parse(initialContent);
 const doc = {published:false,version:"synthetic-v1",operatorName:"Синтетический оператор",operatorDetails:"Только тестовые реквизиты",text:"Только тестовый документ"};
 data.profile.callbackConsent = doc;
 assert.equal("callbackConsent" in publicContent(data).profile, false);
 assert.equal(data.profile.callbackConsent.operatorName, doc.operatorName);
 data.profile.callbackConsent = {...doc,published:true,text:" "};
 assert.equal("callbackConsent" in publicContent(data).profile, false);
 data.profile.callbackConsent = {...doc,published:true};
 assert.deepEqual(publicContent(data).profile.callbackConsent, {...doc,published:true});
 const old = structuredClone(initialContent); delete old.profile.callbackConsent;
 assert.equal(contentSchema.parse(old).profile.callbackConsent.published, false);
});
test("dialog permits its own native scroll while smooth scrolling is stopped", async () => {
 const source = await readFile(new URL("../src/ContactChoiceDialog.jsx", import.meta.url), "utf8");
 assert.match(source, /<dialog[\s\S]*?data-lenis-prevent/);
 const css = await readFile(new URL("../src/editorial.css", import.meta.url), "utf8");
 assert.doesNotMatch(css, /object-position:[^;]*!important/);
});
test("consent view renders no unpublished fields and escapes complete owner text", async () => {
 const { transform } = await import("esbuild");
 const { callbackDocument } = await import("../shared/callbacks.mjs");
 const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
 const section = app.slice(app.indexOf("function CallbackConsentPage()"), app.indexOf("function Legal("));
 const compiled = await transform(section,{loader:"jsx"});
 const renderDoc = callbackConsent => {
  const Page = new Function("React","useSite","callbackDocument","Link",compiled.code+";return CallbackConsentPage;")(React,()=>({data:{profile:{callbackConsent}}}),callbackDocument,({to,children})=>React.createElement("a",{href:to},children));
  return renderToStaticMarkup(React.createElement(Page));
 };
 assert.match(renderDoc(undefined),/пока не опубликован/);
 const doc={published:false,version:"synthetic",operatorName:"Private draft",operatorDetails:"Synthetic only",text:"<script>owner text</script>"};
 assert.doesNotMatch(renderDoc(doc),/Private draft|owner text/);
 const html=renderDoc({...doc,published:true});
 assert.match(html,/&lt;script&gt;owner text/);
 assert.doesNotMatch(html,/<script>/);
});
test("callback displays distinct consent and privacy links, without disabled intake inputs", async () => {
 const { default: CallbackForm } = loadComponent("CallbackForm.jsx");
 assert.doesNotMatch(render(CallbackForm,{profile:{phone:"+79000000000"}}),/<input|<form/);
 const source = await readFile(new URL("../src/CallbackForm.jsx",import.meta.url),"utf8");
 assert.match(source,/config.consentUrl \|\| "\/callback-consent"/);
 assert.match(source,/config.privacyUrl \|\| "\/privacy"/);
});
test("all public route offsets use measured header height, and the short home has no absent anchor", async () => {
 const app = await readFile(new URL("../src/App.jsx",import.meta.url),"utf8");
 const css = await readFile(new URL("../src/editorial.css",import.meta.url),"utf8");
 assert.match(app,/new ResizeObserver\(measure\)/);
 assert.match(app,/setProperty\("--header-height"/);
 assert.match(css,/\.documents-hero,\.article-page,\.legal-page,\.not-found \{ padding-top: calc\(var\(--header-height\)/);
 assert.doesNotMatch(app,/href="#introduction"/);
 assert.match(app,/<Link to="\/about" className="hero-scroll">/);
});

test("disabled callback suggests direct contact only with a valid published phone", () => {
 const { default: CallbackForm } = loadComponent("CallbackForm.jsx");
 for (const phone of ["", "not-a-number"]) {
  const html = render(CallbackForm,{profile:{phone}});
  assert.match(html,/Обратный звонок пока недоступен/);
  assert.doesNotMatch(html,/Можно связаться с Анной напрямую|Воспользуйтесь прямой связью|href="tel:|<input|<form/);
 }
 const html = render(CallbackForm,{profile:{phone:"+79000000000"}});
 assert.match(html,/Можно связаться с Анной напрямую/);
 assert.match(html,/href="tel:\+79000000000"/);
});

test("dialog keyboard wraps both boundaries without intercepting Escape", async () => {
 const { cycleDialogFocus } = await import("../src/dialog-focus.mjs");
 let focused, prevented=0;
 const item=()=>({tabIndex:0,getClientRects:()=>[{}],focus(){focused=this;}});
 const first=item(), last=item(), disabled={...item(),disabled:true};
 const dialog={querySelectorAll:()=>[first,disabled,last],ownerDocument:{activeElement:last}};
 const event={key:'Tab',currentTarget:dialog,preventDefault(){prevented++;}};
 cycleDialogFocus(event); assert.equal(focused,first);
 dialog.ownerDocument.activeElement=first; cycleDialogFocus({...event,shiftKey:true}); assert.equal(focused,last);
 cycleDialogFocus({...event,key:'Escape'}); assert.equal(prevented,2);
});

test("callback consent is separate from informational privacy policy",async()=>{
 const source=await readFile(new URL('../src/CallbackForm.jsx',import.meta.url),'utf8');
 const label=source.match(/<label className="callback-consent">[\s\S]*?<\/label>/)[0];
 assert.match(label,/config.consentText/);
 assert.match(label,/config.consentUrl/);
 assert.doesNotMatch(label,/privacyUrl|Политика конфиденциальности/);
 assert.match(source,/className="contact-note callback-privacy"/);
 assert.match(source,/\[consent, setConsent\] = useState\(false\)/);
 assert.match(source,/if \(pending.current \|\| !config\?\.enabled \|\| !consent\) return/);
});

test("callback modal is gated, single-form, uniquely labelled and busy-close protected",async()=>{
 const source=await readFile(new URL('../src/CallbackForm.jsx',import.meta.url),'utf8');
 assert.match(source,/const uid = useId\(\)/);
 assert.match(source,/nativeDialog && \(config\?\.enabled \|\| modalOpen\)/);
 assert.equal((source.match(/<form /g)||[]).length,1);
 assert.match(source,/if\(pending.current\) \{ setCloseNotice\(true\); return;/);
 assert.match(source,/onCancel=\{useModal \? event => \{ event.preventDefault\(\); closeDialog\(\)/);
 assert.match(source,/setConsent\(false\); setCloseNotice\(false\)/);
 assert.match(source,/unlock.current\?\.\(\)/);
});

test("callback close restores current remounted trigger after consent refresh",async()=>{
 const source=await readFile(new URL('../src/CallbackForm.jsx',import.meta.url),'utf8');
 assert.match(source,/ref=\{triggerRef\}[^>]*onClick=\{goToForm\}/);
 const close=source.slice(source.indexOf('function releaseDialog()'),source.indexOf('function closeDialog()'));
 assert.ok(close.indexOf('if(saved)')<close.indexOf('triggerRef.current?.isConnected'));
 assert.ok(close.indexOf('triggerRef.current?.isConnected')<close.indexOf('opener.current?.isConnected'));
 assert.match(close,/else heading.current\?\.focus/);
});
