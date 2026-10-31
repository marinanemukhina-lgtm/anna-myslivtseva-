// Synthetic commercial records only. Never use these fixtures for actual billing.
export const commercialDemo = {
  "DEMO-001": { prices:[3500,3500,4000,4000,4500,4500], paid:[3500,3500,3600,4000,4050,4500], costs:[650,650,750,750,850,850], discounts:["Без акции","Без акции","−10%","Без акции","−10%","Без акции"], preference:"Утренние часы, вторник или четверг", note:"Предпочитает напоминание за день", cancellations:0 },
  "DEMO-002": { prices:[4000,4000,4000,4500], paid:[4000,3600,4000,4500], costs:[750,750,750,850], discounts:["Без акции","−10%","Без акции","Без акции"], preference:"После 18:00", note:"Просит заранее сообщать о переносе", cancellations:1 },
  "DEMO-003": { prices:[3500,3500,3500,4000,4000], paid:[3500,3500,3150,4000,3600], costs:[650,650,650,750,750], discounts:["Без акции","Без акции","−10%","Без акции","−10%"], preference:"Суббота", note:"Предпочитает сообщения, не звонки", cancellations:0 },
};
export function summarizeCommercial(row) {
  const sum = xs => xs.reduce((a,b)=>a+b,0);
  const revenue=sum(row.paid), directCosts=sum(row.costs), discount=sum(row.prices)-revenue;
  return {revenue,directCosts,discount,contribution:revenue-directCosts,average:Math.round(revenue/row.paid.length)};
}
