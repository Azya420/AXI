export const MAX_FIGURINES = 20;
export const PRICING_VERSION = '2026-11-25-prices';
export const TERMS_VERSION = '2026-11-26';
export const AUTOMATIC_DISCOUNT_PERCENT = 0;
export const SHIPPING_AMOUNT = 1649;
export const DELIVERY_OPTIONS = Object.freeze({
  locker: Object.freeze({ amount: SHIPPING_AMOUNT, displayName: 'Paczkomat InPost' }),
  address: Object.freeze({ amount: 1949, displayName: 'Dostawa na adres' })
});
export const BULK_MIN_FIGURINES = 3;
// Kwoty w groszach. Cena bazowa nie jest deklaracją historycznej ceny z 30 dni.
// Rabat jest naliczany także na serwerze; klient nie przekazuje własnych kwot.
export const PRICE_BRACKETS = [
  { min: 20, max: 60, label: '20–60 mm', regularAmount: 11800, pairAmount: 10600, bulkAmount: 7800, additionalCopyAmount: 1000 },
  { min: 61, max: 100, label: '61–100 mm', regularAmount: 15100, pairAmount: 13900, bulkAmount: 12600, additionalCopyAmount: 2000 },
  { min: 101, max: 150, label: '101–150 mm', regularAmount: 21000, pairAmount: 19800, bulkAmount: 18000, additionalCopyAmount: 4000 },
  { min: 151, max: 200, label: '151–200 mm', regularAmount: 26900, pairAmount: 25700, bulkAmount: 23400, additionalCopyAmount: 8000 },
  { min: 201, max: 250, label: '201–250 mm', regularAmount: 33600, pairAmount: 32400, bulkAmount: 29400, additionalCopyAmount: 15000 }
].map(price => Object.freeze({
  ...price,
  saleAmount: price.regularAmount,
  amount: price.regularAmount
}));
export function getPrice(size, figurineCount = 1) {
  if (!Number.isInteger(size)) return null;
  const price = PRICE_BRACKETS.find(item => size >= item.min && size <= item.max);
  if (!price) return null;
  if (figurineCount >= BULK_MIN_FIGURINES) return { ...price, amount: price.bulkAmount };
  if (figurineCount === 2) return { ...price, amount: price.pairAmount };
  return price;
}
export function getItemSubtotal(size, copies = 1, figurineCount = 1) {
  const price = getPrice(size, figurineCount);
  if (!price || !Number.isSafeInteger(copies) || copies < 1) return null;
  return price.amount + (copies - 1) * price.additionalCopyAmount;
}
export function getDeliveryOption(deliveryMethod) {
  return Object.hasOwn(DELIVERY_OPTIONS, deliveryMethod) ? DELIVERY_OPTIONS[deliveryMethod] : null;
}
export function formatPrice(amount) {
  return (amount / 100).toLocaleString('pl-PL') + ' zł';
}
