// Food groups of «Цифровой сомелье» -> the catalog's pairing dishes (the wineries' own recommendations).
// Shared by the chips (only groups the wine is recommended for are offered) and POST /api/sommelier.
export const FOOD: Record<string, { chip: string, label: string, dishes: string[] }> = {
  meat: { chip: 'Мясо', label: 'мясу', dishes: ['Мясо и стейки', 'BBQ', 'Мясное ассорти', 'Кавказская кухня'] },
  bird: { chip: 'Птица', label: 'птице', dishes: ['Блюда из птицы'] },
  fish: { chip: 'Рыба', label: 'рыбе и морепродуктам', dishes: ['Рыба и морепродукты', 'Блюда из рыбы', 'Морепродукты', 'Устрицы'] },
  cheese: { chip: 'Сыры', label: 'сырам', dishes: ['Сыры'] },
  pasta: { chip: 'Паста и пицца', label: 'пасте и пицце', dishes: ['Паста', 'Пицца', 'Средиземноморская кухня'] },
  snacks: { chip: 'Закуски', label: 'закускам и салатам', dishes: ['Легкие закуски', 'Лёгкие закуски', 'Закуски', 'Салаты', 'Брускетты', 'Паштеты'] },
  spicy: { chip: 'Острое', label: 'острому и азиатской кухне', dishes: ['Азиатская кухня', 'Острое'] },
  dessert: { chip: 'Десерты', label: 'десертам', dishes: ['Десерты', 'Выпечка и десерты', 'Фруктово-ягодные десерты', 'Шоколад', 'Мороженое', 'Фрукты'] },
  veg: { chip: 'Овощи', label: 'овощам', dishes: ['Овощи гриль', 'Запеченные овощи', 'Свежие овощи'] },
}
/** Food groups the wine is recommended for, in the catalog order of its dishes. */
export const foodsFor = (dishes: string[] = []) => Object.keys(FOOD).filter(k => FOOD[k]!.dishes.some(d => dishes.includes(d)))
