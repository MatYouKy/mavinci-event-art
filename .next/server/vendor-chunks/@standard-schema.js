"use strict";
/*
 * ATTENTION: An "eval-source-map" devtool has been used.
 * This devtool is neither made for production nor for readable output files.
 * It uses "eval()" calls to create a separate source file with attached SourceMaps in the browser devtools.
 * If you are trying to read the output file, select a different devtool (https://webpack.js.org/configuration/devtool/)
 * or disable the default devtool with "devtool: false".
 * If you are looking for production-ready output files, see mode: "production" (https://webpack.js.org/configuration/mode/).
 */
exports.id = "vendor-chunks/@standard-schema";
exports.ids = ["vendor-chunks/@standard-schema"];
exports.modules = {

/***/ "(ssr)/./node_modules/@standard-schema/utils/dist/index.js":
/*!***********************************************************!*\
  !*** ./node_modules/@standard-schema/utils/dist/index.js ***!
  \***********************************************************/
/***/ ((__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) => {

eval("__webpack_require__.r(__webpack_exports__);\n/* harmony export */ __webpack_require__.d(__webpack_exports__, {\n/* harmony export */   SchemaError: () => (/* binding */ SchemaError),\n/* harmony export */   getDotPath: () => (/* binding */ getDotPath)\n/* harmony export */ });\n// src/getDotPath/getDotPath.ts\nfunction getDotPath(issue) {\n  if (issue.path?.length) {\n    let dotPath = \"\";\n    for (const item of issue.path) {\n      const key = typeof item === \"object\" ? item.key : item;\n      if (typeof key === \"string\" || typeof key === \"number\") {\n        if (dotPath) {\n          dotPath += `.${key}`;\n        } else {\n          dotPath += key;\n        }\n      } else {\n        return null;\n      }\n    }\n    return dotPath;\n  }\n  return null;\n}\n\n// src/SchemaError/SchemaError.ts\nvar SchemaError = class extends Error {\n  /**\n   * The schema issues.\n   */\n  issues;\n  /**\n   * Creates a schema error with useful information.\n   *\n   * @param issues The schema issues.\n   */\n  constructor(issues) {\n    super(issues[0].message);\n    this.name = \"SchemaError\";\n    this.issues = issues;\n  }\n};\n\n//# sourceURL=[module]\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiKHNzcikvLi9ub2RlX21vZHVsZXMvQHN0YW5kYXJkLXNjaGVtYS91dGlscy9kaXN0L2luZGV4LmpzIiwibWFwcGluZ3MiOiI7Ozs7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBLHlCQUF5QixJQUFJO0FBQzdCLFVBQVU7QUFDVjtBQUNBO0FBQ0EsUUFBUTtBQUNSO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFJRSIsInNvdXJjZXMiOlsid2VicGFjazovL21hdmluY2ktbmV4dGpzLy4vbm9kZV9tb2R1bGVzL0BzdGFuZGFyZC1zY2hlbWEvdXRpbHMvZGlzdC9pbmRleC5qcz9hNDBkIl0sInNvdXJjZXNDb250ZW50IjpbIi8vIHNyYy9nZXREb3RQYXRoL2dldERvdFBhdGgudHNcbmZ1bmN0aW9uIGdldERvdFBhdGgoaXNzdWUpIHtcbiAgaWYgKGlzc3VlLnBhdGg/Lmxlbmd0aCkge1xuICAgIGxldCBkb3RQYXRoID0gXCJcIjtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXNzdWUucGF0aCkge1xuICAgICAgY29uc3Qga2V5ID0gdHlwZW9mIGl0ZW0gPT09IFwib2JqZWN0XCIgPyBpdGVtLmtleSA6IGl0ZW07XG4gICAgICBpZiAodHlwZW9mIGtleSA9PT0gXCJzdHJpbmdcIiB8fCB0eXBlb2Yga2V5ID09PSBcIm51bWJlclwiKSB7XG4gICAgICAgIGlmIChkb3RQYXRoKSB7XG4gICAgICAgICAgZG90UGF0aCArPSBgLiR7a2V5fWA7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZG90UGF0aCArPSBrZXk7XG4gICAgICAgIH1cbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gZG90UGF0aDtcbiAgfVxuICByZXR1cm4gbnVsbDtcbn1cblxuLy8gc3JjL1NjaGVtYUVycm9yL1NjaGVtYUVycm9yLnRzXG52YXIgU2NoZW1hRXJyb3IgPSBjbGFzcyBleHRlbmRzIEVycm9yIHtcbiAgLyoqXG4gICAqIFRoZSBzY2hlbWEgaXNzdWVzLlxuICAgKi9cbiAgaXNzdWVzO1xuICAvKipcbiAgICogQ3JlYXRlcyBhIHNjaGVtYSBlcnJvciB3aXRoIHVzZWZ1bCBpbmZvcm1hdGlvbi5cbiAgICpcbiAgICogQHBhcmFtIGlzc3VlcyBUaGUgc2NoZW1hIGlzc3Vlcy5cbiAgICovXG4gIGNvbnN0cnVjdG9yKGlzc3Vlcykge1xuICAgIHN1cGVyKGlzc3Vlc1swXS5tZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSBcIlNjaGVtYUVycm9yXCI7XG4gICAgdGhpcy5pc3N1ZXMgPSBpc3N1ZXM7XG4gIH1cbn07XG5leHBvcnQge1xuICBTY2hlbWFFcnJvcixcbiAgZ2V0RG90UGF0aFxufTtcbiJdLCJuYW1lcyI6W10sInNvdXJjZVJvb3QiOiIifQ==\n//# sourceURL=webpack-internal:///(ssr)/./node_modules/@standard-schema/utils/dist/index.js\n");

/***/ })

};
;