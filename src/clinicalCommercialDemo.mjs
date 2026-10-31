// Synthetic commercial records only. Never use these fixtures for actual billing.
export const commercialDemo = {
  "DEMO-001": { prices:[3500,3500,4000,4000,4500,4500], paid:[3500,3500,3600,4000,4050,4500], costs:[650,650,750,750,850,850], discounts:["Без акции","Без акции","−10%","Без акции","−10%","Без акции"], preference:"Утренние часы, вторник или четверг", note:"Предпочитает напоминание за день", cancellations:0 },
  "DEMO-002": { prices:[4000,4000,4000,4500], paid:[4000,3600,4000,4500], costs:[750,750,750,850], discounts:["Без акции","−10%","Без акции","Без акции"], preference:"После 18:00", note:"Просит заранее сообщать о переносе", cancellations:1 },
  "DEMO-003": { prices:[3500,3500,3500,4000,4000], paid:[3500,3500,3150,4000,3600], costs:[650,650,650,750,750], discounts:["Без акции","Без акции","−10%","Без акции","−10%"], preference:"Суббота", note:"Предпочитает сообщения, не звонки", cancellations:0 },
};
export function datedPayments(row, year=2026) {
  // Explicit synthetic service and payment dates; these may differ in real records.
  const months=[2,3,5,7,9,10];
  return row.paid.map((paid,i)=>({
    id:"DEMO-PAY-"+i,
    visitDate:year+"-"+String(months[i%months.length]).padStart(2,"0")+"-"+String(4+(i*4)%23).padStart(2,"0"),
    paidDate:year+"-"+String(months[i%months.length]).padStart(2,"0")+"-"+String(5+(i*4)%23).padStart(2,"0"),
    paid,price:row.prices[i],cost:row.costs[i],discount:row.discounts[i],
  }));
}
export function visitPatterns(row) {
 const entries=datedPayments(row);
 const byMonth={},byWeekday={};
 entries.forEach(e=>{const m=e.visitDate.slice(0,7),d=new Date(e.visitDate+"T12:00:00Z").toLocaleDateString("ru-RU",{weekday:"long",timeZone:"UTC"});byMonth[m]=(byMonth[m]||0)+1;byWeekday[d]=(byWeekday[d]||0)+1;});
 return {byMonth,byWeekday,lastVisit:entries.map(e=>e.visitDate).sort().at(-1)};
}
export function summarizeCommercial(row) {
  const sum = xs => xs.reduce((a,b)=>a+b,0);
  const revenue=sum(row.paid), directCosts=sum(row.costs), discount=sum(row.prices)-revenue;
  return {revenue,directCosts,discount,contribution:revenue-directCosts,average:Math.round(revenue/row.paid.length)};
}
