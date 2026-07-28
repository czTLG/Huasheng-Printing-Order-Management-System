#!/usr/bin/env node
'use strict';

const assert = require('node:assert');
const { profileFor, verifyProfileRoutes } = require('../src/services/matrixRouteProfiles');

(async () => {
  const food = profileFor({ countryCode: 'VN', categories: ['sauces', 'seasonings'] });
  assert.strictEqual(food.kind, 'food_sauce');
  assert.strictEqual(food.application, '/vi/applications/sauce-packaging');
  assert.strictEqual(food.product, '/vi/products/spout-pouches');
  assert.match(food.courtesy, /Cảm ơn Quý công ty/);

  const liquid = profileFor({ countryCode: 'ID', categories: ['liquid detergent'] });
  assert.strictEqual(liquid.kind, 'liquid_care');
  assert.strictEqual(liquid.application, '/id/applications/daily-chemical-packaging');

  const uaeSnack = profileFor({ countryCode: 'AE', categories: ['nuts', 'snacks'] });
  assert.strictEqual(uaeSnack.kind, 'food_snack_ar');
  assert.strictEqual(uaeSnack.market, '/ar/markets/middle-east-food-packaging');
  assert.strictEqual(uaeSnack.application, '/ar/applications/snack-packaging');
  assert.strictEqual(uaeSnack.product, '/ar/products/food-packaging-roll-film');
  assert.strictEqual(uaeSnack.about, '/ar/about');
  assert.strictEqual(uaeSnack.expectedLanguage, 'ar');
  assert.strictEqual(profileFor({ countryCode: 'AE', categories: ['industrial chemicals'] }), null);
  const malaysiaSeasoning = profileFor({ countryCode: 'MY', categories: ['spices', 'seasonings'] });
  assert.strictEqual(malaysiaSeasoning.kind, 'malaysia_seasoning');
  assert.strictEqual(malaysiaSeasoning.language, 'en');
  assert.strictEqual(malaysiaSeasoning.market, '/markets/malaysia-food-packaging');
  assert.strictEqual(malaysiaSeasoning.application, '/applications/food-snack-packaging');
  assert.strictEqual(malaysiaSeasoning.product, '/products/food-packaging-roll-film');
  assert.match(malaysiaSeasoning.courtesy, /Terima kasih/);

  assert.strictEqual(profileFor({ countryCode: 'VN', categories: ['steel'] }), null);

  const requested = [];
  const verified = await verifyProfileRoutes(food, {
    origin: 'https://site.test',
    fetchImpl: async url => {
      requested.push(url);
      const route = new URL(url).pathname;
      return {
        ok: true,
        text: async () => route === food.application
          ? `<html lang="vi"><link rel="canonical" href="${route}"></html>`
          : '<html lang="vi"></html>'
      };
    },
    timeoutMs: 1000
  });
  assert.strictEqual(verified, food);
  assert.strictEqual(requested.length, 5);

  await assert.rejects(
    () => verifyProfileRoutes(food, {
      origin: 'https://site.test',
      fetchImpl: async () => ({ ok: false, text: async () => '' }),
      timeoutMs: 1000
    }),
    /localized website route unavailable/
  );

  await assert.rejects(
    () => verifyProfileRoutes(food, {
      origin: 'https://site.test',
      fetchImpl: async url => {
        const route = new URL(url).pathname;
        return {
          ok: true,
          text: async () => route === food.application
            ? `<html lang="en"><link rel="canonical" href="${route}"></html>`
            : '<html lang="vi"></html>'
        };
      },
      timeoutMs: 1000
    }),
    /expected canonical page/
  );

  console.log('matrix route profile tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
