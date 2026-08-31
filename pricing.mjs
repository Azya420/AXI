export const MAX_FIGURINES = 20;
export const PRICING_VERSION = '2026-08-31-shipping-v1';
export const AUTOMATIC_DISCOUNT_PERCENT = 30;
export const SHIPPING_AMOUNT = 1649;
// Kwoty w groszach. Cena bazowa nie jest deklaracją historycznej ceny z 30 dni.
// Rabat jest naliczany także na serwerze; klient nie przekazuje własnych kwot.
export const PRICE_BRACKETS = [
  { min: 20, max: 60, label: '20–60 mm', regularAmount: 14000 },
  { min: 61, max: 100, label: '61–100 mm', regularAmount: 18000 },
  { min: 101, max: 150, label: '101–150 mm', regularAmount: 25000 },
  { min: 151, max: 200, label: '151–200 mm', regularAmount: 32000 },
  { min: 201, max: 250, label: '201–250 mm', regularAmount: 40000 }
].map(price => Object.freeze({
  ...price,
  amount: Math.round(price.regularAmount * (100 - AUTOMATIC_DISCOUNT_PERCENT) / 100)
}));
export function getPrice(size) {
  if (!Number.isInteger(size)) return null;
  return PRICE_BRACKETS.find(price => size >= price.min && size <= price.max) || null;
}
export function formatPrice(amount) {
  return (amount / 100).toLocaleString('pl-PL') + ' zł';
}
