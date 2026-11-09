// Explicit synthetic fixtures only. Never defaults or production seed content.
export function syntheticCallbackConsent() {
  return {
    published: true,
    version: 'synthetic-callback-v1',
    operatorName: 'Синтетический оператор',
    operatorDetails: 'Вымышленные реквизиты только для автоматического теста.',
    text: 'Синтетическое согласие на обработку номера для обратного звонка. Не юридический документ и не для публикации.',
  };
}
