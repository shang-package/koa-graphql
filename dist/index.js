'use strict';

var _typeof2 = require('babel-runtime/helpers/typeof');

var _typeof3 = _interopRequireDefault(_typeof2);

var _graphql = require('graphql');

var _expressGraphql = require('express-graphql');

var _httpErrors = require('http-errors');

var _httpErrors2 = _interopRequireDefault(_httpErrors);

var _renderGraphiQL = require('./renderGraphiQL');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

/**
 * Middleware for express; takes an options object or function as input to
 * configure behavior, and returns an express middleware.
 */


/**
 * Used to configure the graphqlHTTP middleware by providing a schema
 * and other configuration options.
 *
 * Options can be provided as an Object, a Promise for an Object, or a Function
 * that returns an Object or a Promise for an Object.
 */
module.exports = graphqlHTTP;
function graphqlHTTP(options) {
  if (!options) {
    throw new Error('GraphQL middleware requires options.');
  }

  return async function middleware(ctx) {
    var req = ctx.req;
    var request = ctx.request;
    var response = ctx.response;

    // Higher scoped variables are referred to at various stages in the
    // asynchronous state machine below.
    var schema = void 0;
    var context = void 0;
    var rootValue = void 0;
    var pretty = void 0;
    var graphiql = void 0;
    var formatErrorFn = void 0;
    var extensionsFn = void 0;
    var showGraphiQL = void 0;
    var query = void 0;
    var documentAST = void 0;
    var variables = void 0;
    var operationName = void 0;
    var validationRules = void 0;

    var result = void 0;

    try {
      // Promises are used as a mechanism for capturing any thrown errors during
      // the asynchronous process below.

      // Resolve the Options to get OptionsData.
      var optionsData = await Promise.resolve(typeof options === 'function' ? options(request, response, ctx) : options);

      // Assert that optionsData is in fact an Object.
      if (!optionsData || (typeof optionsData === 'undefined' ? 'undefined' : (0, _typeof3.default)(optionsData)) !== 'object') {
        throw new Error('GraphQL middleware option function must return an options object ' + 'or a promise which will be resolved to an options object.');
      }

      // Assert that schema is required.
      if (!optionsData.schema) {
        throw new Error('GraphQL middleware options must contain a schema.');
      }

      // Collect information from the options data object.
      schema = optionsData.schema;
      context = optionsData.context || ctx;
      rootValue = optionsData.rootValue;
      pretty = optionsData.pretty;
      graphiql = optionsData.graphiql;
      formatErrorFn = optionsData.formatError;
      extensionsFn = optionsData.extensions;

      validationRules = _graphql.specifiedRules;
      if (optionsData.validationRules) {
        validationRules = validationRules.concat(optionsData.validationRules);
      }

      // GraphQL HTTP only supports GET and POST methods.
      if (request.method !== 'GET' && request.method !== 'POST') {
        response.set('Allow', 'GET, POST');
        throw (0, _httpErrors2.default)(405, 'GraphQL only supports GET and POST requests.');
      }

      // Use request.body when req.body is undefined.
      req.body = req.body || request.body;

      // Parse the Request to get GraphQL request parameters.
      var params = await (0, _expressGraphql.getGraphQLParams)(req);

      // Get GraphQL params from the request and POST body data.
      query = params.query;
      variables = params.variables;
      operationName = params.operationName;
      showGraphiQL = graphiql && canDisplayGraphiQL(request, params);

      result = await new Promise(function (resolve) {
        // If there is no query, but GraphiQL will be displayed, do not produce
        // a result, otherwise return a 400: Bad Request.
        if (!query) {
          if (showGraphiQL) {
            resolve(null);
          }
          throw (0, _httpErrors2.default)(400, 'Must provide query string.');
        }

        // GraphQL source.
        var source = new _graphql.Source(query, 'GraphQL request');

        // Parse source to AST, reporting any syntax error.
        try {
          documentAST = (0, _graphql.parse)(source);
        } catch (syntaxError) {
          // Return 400: Bad Request if any syntax errors errors exist.
          response.status = 400;
          resolve({ errors: [syntaxError] });
        }

        // Validate AST, reporting any errors.
        var validationErrors = (0, _graphql.validate)(schema, documentAST, validationRules);
        if (validationErrors.length > 0) {
          // Return 400: Bad Request if any validation errors exist.
          response.status = 400;
          resolve({ errors: validationErrors });
        }

        // Only query operations are allowed on GET requests.
        if (request.method === 'GET') {
          // Determine if this GET request will perform a non-query.
          var operationAST = (0, _graphql.getOperationAST)(documentAST, operationName);
          if (operationAST && operationAST.operation !== 'query') {
            // If GraphiQL can be shown, do not perform this query, but
            // provide it to GraphiQL so that the requester may perform it
            // themselves if desired.
            if (showGraphiQL) {
              resolve(null);
            }

            // Otherwise, report a 405: Method Not Allowed error.
            response.set('Allow', 'POST');
            throw (0, _httpErrors2.default)(405, 'Can only perform a ' + operationAST.operation + ' operation ' + 'from a POST request.');
          }
        }

        // Perform the execution, reporting any errors creating the context.
        try {
          resolve((0, _graphql.execute)(schema, documentAST, rootValue, context, variables, operationName));
        } catch (contextError) {
          // Return 400: Bad Request if any execution context errors exist.
          response.status = 400;
          resolve({ errors: [contextError] });
        }
      });

      // Collect and apply any metadata extensions if a function was provided.
      // http://facebook.github.io/graphql/#sec-Response-Format
      if (result && extensionsFn) {
        result = await Promise.resolve(extensionsFn({
          document: documentAST,
          variables: variables,
          operationName: operationName,
          result: result
        })).then(function (extensions) {
          if (extensions && (typeof extensions === 'undefined' ? 'undefined' : (0, _typeof3.default)(extensions)) === 'object') {
            result.extensions = extensions;
          }
          return result;
        });
      }
    } catch (error) {
      // If an error was caught, report the httpError status, or 500.
      response.status = error.status || 500;
      result = { errors: [error] };
    }

    // If no data was included in the result, that indicates a runtime query
    // error, indicate as such with a generic status code.
    // Note: Information about the error itself will still be contained in
    // the resulting JSON payload.
    // http://facebook.github.io/graphql/#sec-Data
    if (result && result.data === null) {
      response.status = 500;
    }
    // Format any encountered errors.
    if (result && result.errors) {
      result.errors = result.errors.map(formatErrorFn || _graphql.formatError);
    }

    // If allowed to show GraphiQL, present it instead of JSON.
    if (showGraphiQL) {
      var payload = (0, _renderGraphiQL.renderGraphiQL)({
        query: query,
        variables: variables,
        operationName: operationName,
        result: result
      });
      response.type = 'text/html';
      response.body = payload;
    } else {
      // Otherwise, present JSON directly.
      var _payload = JSON.stringify(result, null, pretty ? 2 : 0);
      response.type = 'application/json';
      response.body = _payload;
    }
  };
}

/**
 * Helper function to determine if GraphiQL can be displayed.
 */
function canDisplayGraphiQL(request, params) {
  // If `raw` exists, GraphiQL mode is not enabled.
  // Allowed to show GraphiQL if not requested as raw and this request
  // prefers HTML over JSON.
  return !params.raw && request.accepts(['json', 'html']) === 'html';
}