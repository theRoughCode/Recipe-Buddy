'use strict';

process.env.DEBUG = 'actions-on-google:*';
const App = require('actions-on-google').DialogflowApp;
const functions = require('firebase-functions');
const httprequest = require('request');
const recipeIngredientParser = require('recipe-ingredient-parser');
const async = require('async');
const { parse } = recipeIngredientParser;

const FOOD_ID = process.env.FOOD_ID;
const FOOD_KEY = process.env.FOOD_KEY;

const CnC_USERNAME = process.env.CnC_USERNAME;
const CnC_PASSWORD = process.env.CnC_PASSWORD;
const CnC_LANG = process.env.CnC_LANG;
const CnC_ACCESS_TOKEN = process.env.CnC_ACCESS_TOKEN;
const CnC_REFRESH_TOKEN = process.env.CnC_REFRESH_TOKEN;
const CnC_CART_ID = process.env.CnC_CART_ID;


// ACTIONS
const NEW_RECIPE_ACTION = 'get_recipe';
const ANOTHER_RECIPE_ACTION = 'get_another_recipe';
const SELECT_RECIPE_ACTION = 'select_recipe';
const GET_PRODUCT_ACTION = 'get_product';
const ADD_PRODUCT_ACTION = 'add_product';
const NEXT_PRODUCT_ACTION = 'next_product';

// ARGUMENTS
const RECIPE_ARGUMENT = 'recipe';
const RECIPE_NUMBER_ARGUMENT = 'number';
const RECIPE_NAME_ARGUMENT = 'recipeName';
const RECIPE_LIST_ARGUMENT = 'recipeList';
const INGREDIENTS_LIST_ARGUMENT = 'ingredientsList';
const INGREDIENTS_ARGUMENT = 'ingredients';
const INDEX_ARGUMENT = 'index';
const PRODUCTS_ARGUMENT = 'products';
const MATCH_ARGUMENT = 'match';
const NUMBER_ARGUMENT = 'number';

// CONTEXTS
const RECIPE_NUMBER_CONTEXT = 'recipeNumber';
const CART_CONTEXT = 'cart';

const API_ENABLED = true;


// Get another recipe
const getAnotherRecipe = (app) => {
  const number = Math.round(Number(app.getArgument(RECIPE_NUMBER_ARGUMENT))) + 1;
  const recipeStr = app.getArgument(RECIPE_LIST_ARGUMENT);

  if (!recipeStr.length) {
    app.tell('Recipe error');
    return;
  }

  const { recipeList } = JSON.parse(recipeStr);

  // No more recipes
  if (number >= recipeList.length) {
    app.tell('Sorry, there are no more recipes left.  Goodbye.');
    return;
  }

  const { ingredients, recipeName, rating, sourceDisplayName } = recipeList[number];

  app.setContext(RECIPE_NUMBER_CONTEXT, 2, {
    number,
    recipeStr,
    ingredients,
    recipeName
  });

  app.ask(`The next recipe is called ${recipeName} with a rating of ${rating}.  The ingredients you'll need are ${ingredients.join(", ")}. Would you like to select this recipe or get another recipe?`);
};

// Get first recipe
const getFirstRecipe = (app) => {
  const recipe = app.getArgument(RECIPE_ARGUMENT);

  httprequest(`https://api.yummly.com/v1/api/recipes?_app_id=${FOOD_ID}&_app_key=${FOOD_KEY}&q=${recipe}`, function(error, resp, body){
    body = JSON.parse(body);

    if (error) {
      console.log('error', error);
      app.tell(`Hmm I couldn't find a recipe for ${recipe}`);
      return;
    } else if (!body.matches || !body.matches.length) {
      console.log('No results found.');
      return;
    }

    async.sortBy(body.matches, (recipe, callback) => {
      // recipe.rating
      callback(null, recipe.totalTimeInSeconds);
    }, (err, result) => {
      const { ingredients, recipeName, rating, sourceDisplayName } = result[0];

      app.setContext(RECIPE_NUMBER_CONTEXT, 2, {
        number: 0,
        recipeStr: JSON.stringify({ recipeList: result }),
        ingredients,
        recipeName
      });

      app.ask(`Voila, found a recipe called ${recipeName} with a rating of ${rating}.  The ingredients you'll need are ${ingredients.join(", ")}.  What would you like to do? Select this recipe or get another recipe for ${recipe}?`);
    });
  });
};

const selectRecipe = (app) => {
  const ingredientsList = app.getArgument(INGREDIENTS_LIST_ARGUMENT);
  const recipeName = app.getArgument(RECIPE_NAME_ARGUMENT);

  if (!ingredientsList || !ingredientsList.length || !recipeName) return;

  const cncUrl = {
    url: `${process.env.CnC_GET_CART}${CnC_CART_ID}`,
    headers: {
      'Authorization': `bearer ${CnC_ACCESS_TOKEN}`
    }
  };

  const firstIngredient = ingredientsList[0];

  httprequest(cncUrl, (error, response, body) => {
    if (!error && response.statusCode == 200) {
      let products = JSON.parse(body).entries;
      if (!products || !products.length) {

        app.setContext(CART_CONTEXT, 2, {
          products,
          ingredients: ingredientsList,
          recipeName,
          index: 0
        });
        app.ask(`Before starting our recipe for ${recipeName}, let's make sure we have all the ingredients we need!  The first ingredient is ${firstIngredient}. We need ${firstIngredient} for our recipe.  Do you want to add ${firstIngredient} to your cart?`);
        return;
      }

      let match = null;

      async.map(products, (item, callback) => {
        const { quantity, product } = item;
        const { id, productName } = product;
        const obj = { quantity, id, productName };

        if (productName.toLowerCase().includes(firstIngredient.toLowerCase())) {
          match = obj;
        }

        callback(null, obj);
      }, (err, results) => {
        if (err) {
          console.log('err', err);
          app.tell('Could not get cart items');
        }

        let msg = (match)
          ? `You have ${match.quantity} items of ${match.productName} in your cart. We need ${firstIngredient} for our recipe. Do you want to add more ${match.productName} to your cart?`
          : `We need ${firstIngredient} for our recipe.  Do you want to add ${firstIngredient} to your cart?`;

        app.setContext(CART_CONTEXT, 2, {
          products: results,
          ingredients: ingredientsList,
          recipeName,
          match,
          index: 0
        });

        app.ask(`Before starting our recipe for ${recipeName}, let's make sure we have all the ingredients we need!  The first ingredient is ${firstIngredient}. ${msg}`);
      });
    } else {
      console.log('error', error);
      return;
    }
  });
}

const searchForProduct = (app, ingredient) => {
  const ingredients = app.getArgument(INGREDIENTS_ARGUMENT);
  const recipeName = app.getArgument(RECIPE_NAME_ARGUMENT);
  const index = Math.round(Number(app.getArgument(INDEX_ARGUMENT)));
  const products = app.getArgument(PRODUCTS_ARGUMENT);
  const sortBy = 'popularity';

  const cncUrl = {
    url: `${process.env.CnC_GET_PRODUCTS}${ingredient.replace(" ", "+")}&sort=${sortBy}`,
    headers: {
      'Authorization': `bearer ${CnC_ACCESS_TOKEN}`
    }
  };

  httprequest(cncUrl, (error, response, body) => {
    if (!error && response.statusCode == 200) {
      const storeItemList = JSON.parse(body).searchResults.products;

      if (!storeItemList.length) {
        app.talk(`Could not find any products for ${ingredient}.`);
        return;
      }

      async.map(storeItemList, (item, callback) => {
        const { id, productName, price } = item;
        const obj = { price, id, productName };

        callback(null, obj);
      }, (err, results) => {
        if (err) {
          console.log('err', err);
          app.tell('Could not get product');
        }

        const { id, productName, price } = results[0];
        app.setContext(CART_CONTEXT, 2, {
          products,
          ingredients,
          recipeName,
          index,
          match: {
            id,
            productName,
            price
          }
        });

        app.ask(`Found a product for ${ingredient} called ${productName} selling for ${price} dollars.  How many of these would you like to add to your cart?`);
      });


    } else {
      console.log('error', error);
      return;
    }
  });
};

const getProduct = (app) => {
  const ingredients = app.getArgument(INGREDIENTS_ARGUMENT);
  const match = app.getArgument(MATCH_ARGUMENT);
  const index = Math.round(Number(app.getArgument(INDEX_ARGUMENT)));

  // search for product
  if (!match) {
    searchForProduct(app, ingredients[index]);
    return;
  } else {
    const recipeName = app.getArgument(RECIPE_NAME_ARGUMENT);
    const products = app.getArgument(PRODUCTS_ARGUMENT);
    const match = app.getArgument(MATCH_ARGUMENT);

    app.setContext(CART_CONTEXT, 2, {
      products,
      match,
      ingredients,
      recipeName,
      index
    });
    app.ask(`How many items of ${match.productName} would you like to add to your cart?`);
    return;
  }
};

const addProduct = (app) => {
  const ingredients = app.getArgument(INGREDIENTS_ARGUMENT);
  const recipeName = app.getArgument(RECIPE_NAME_ARGUMENT);
  const products = app.getArgument(PRODUCTS_ARGUMENT);
  const quantity = app.getArgument(NUMBER_ARGUMENT);
  let index = Math.round(Number(app.getArgument(INDEX_ARGUMENT)));
  let match = app.getArgument(MATCH_ARGUMENT);
  let quantity2 = (match.quantity) ? Number(quantity) + Number(match.quantity) : quantity;

  const cncUrl = {
    method: 'PUT',
    url: `${process.env.CnC_GET_CART}${CnC_CART_ID}/entry`,
    headers: {
      'Authorization': `bearer ${CnC_ACCESS_TOKEN}`
    },
    json: true,
    body: {
      productId: match.id,
      quantity: quantity2
    }
  };

  httprequest(cncUrl, (error, response, body) => {
    if (!error) {
      index += 1;
      if (index >= ingredients.length) {
        app.setContext('nps', 5);

        app.tell(`You're done adding to cart!  Can't wait to start making ${recipeName} with you!  On a scale from 1 to 5, how likely would you refer this service to a friend?`);
        return;
      }

      const nextIngredient = ingredients[index].toLowerCase();

      async.filter(products, (item, callback) => {
        callback(null, item.productName.toLowerCase().includes(nextIngredient));
      }, (err, results) => {
        let msg = `We need ${nextIngredient} for our recipe.  Do you want to add ${nextIngredient} to your cart?`;

        let match2 = null;
        if (results.length) {
          const { id, productName, quantity } = results[0];
          match2 = { quantity, id, productName };

          msg = `You have ${match2.quantity} items of ${match2.productName} in your cart. We need ${nextIngredient} for our recipe. Do you want to add more ${nextIngredient} to your cart?`;
        }

        app.setContext(CART_CONTEXT, 2, {
          products,
          ingredients,
          recipeName,
          match: match2,
          index
        });

        app.ask(`${quantity} ${match.productName} has been added to your cart.  Our next ingredient is ${nextIngredient}. ${msg}`);
        return;
      });
    } else {
      console.log('error', error);
      return;
    }
  })
};

const nextProduct = (app) => {
    const ingredients = app.getArgument(INGREDIENTS_ARGUMENT);
    let match = app.getArgument(MATCH_ARGUMENT);
    const index = Math.round(Number(app.getArgument(INDEX_ARGUMENT))) + 1;
    const recipeName = app.getArgument(RECIPE_NAME_ARGUMENT);
    const products = app.getArgument(PRODUCTS_ARGUMENT);

    if (index >= ingredients.length) {
      app.setContext('nps', 5);
      app.tell(`You're done adding to cart!  Can't wait to start making ${recipeName} with you! On a scale from 1 to 5, how likely would you refer this service to a friend?`);
      return;
    }

    const nextIngredient = ingredients[index];

    async.filter(products, (item, callback) => {
      callback(null, item.productName.toLowerCase().includes(nextIngredient));
    }, (err, results) => {
      let msg = `We need ${nextIngredient} for our recipe.  Do you want to add ${nextIngredient} to your cart?`;

      match = null;
      if (results.length) {
        const { quantity, product } = results[0];
        const { id, productName } = product;
        match = { quantity, id, productName };

        msg = `You have ${match.quantity} items of ${match.productName} in your cart. We need ${nextIngredient} for our recipe. Do you want to add more ${nextIngredient} to your cart?`;
      }

      app.setContext(CART_CONTEXT, 2, {
        products,
        ingredients,
        recipeName,
        match,
        index
      });

      app.ask(`Ok. Our next ingredient is ${nextIngredient}. ${msg}`);
      return;
    });
}


exports.recipeBuddy = functions.https.onRequest((request, response) => {
  const app = new App({ request, response });

  // d. build an action map, which maps intent names to functions
  let actionMap = new Map();
  actionMap.set(NEW_RECIPE_ACTION, getFirstRecipe);
  actionMap.set(ANOTHER_RECIPE_ACTION, getAnotherRecipe);
  actionMap.set(SELECT_RECIPE_ACTION, selectRecipe);
  actionMap.set(GET_PRODUCT_ACTION, getProduct);
  actionMap.set(ADD_PRODUCT_ACTION, addProduct);
  actionMap.set(NEXT_PRODUCT_ACTION, nextProduct);

  app.handleRequest(actionMap);
});
