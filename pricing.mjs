export const MAX_FIGURINES = 20;
// Zachowane przedziały i ceny z dotychczasowego formularza (kwoty w groszach).
// Luki między przedziałami nie mają ustalonej ceny — nie wyceniamy ich automatycznie.
export const PRICE_BRACKETS = [
  { min: 20, max: 60, label: '20–60 mm', amount: 20000 },
  { min: 70, max: 100, label: '70–100 mm', amount: 22000 },
  { min: 110, max: 150, label: '110–150 mm', amount: 25000 },
  { min: 160, max: 200, label: '160–200 mm', amount: 28000 },
  { min: 210, max: 250, label: '210–250 mm', amount: 34000 }
];
export function getPrice(size) {
  if (!Number.isInteger(size)) return null;
  return PRICE_BRACKETS.find(price => size >= price.min && size <= price.max) || null;
}
export function formatPrice(amount) {
  return (amount / 100).toLocaleString('pl-PL') + ' zł';
}
