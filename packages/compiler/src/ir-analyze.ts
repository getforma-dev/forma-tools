/**
 * Forma Compiler - IR Analysis Pass
 *
 * Classifies h() call subtrees as static, dynamic, or island BEFORE
 * the main transform runs. This classification determines what goes
 * into binary IR (static), what needs slot data (dynamic), and what
 * stays as full client-side code (island).
 */

import * as t from '@babel/types';

// ---------------------------------------------------------------------------
// Classification Enum
// ---------------------------------------------------------------------------

export enum SubtreeClassification {
  /** All literals -- can be baked into IR. */
  Static = 'static',
  /** Contains function calls / signal reads -- needs slot data. */
  Dynamic = 'dynamic',
  /** Contains event handlers or client-side state -- becomes an island. */
  Island = 'island',
}

// ---------------------------------------------------------------------------
// Detection Helpers
// ---------------------------------------------------------------------------

/** Check if a prop key is an event handler (onClick, onInput, etc.). */
function isEventProp(key: string): boolean {
  return key.length > 2
    && key.charCodeAt(0) === 111 // 'o'
    && key.charCodeAt(1) === 110 // 'n'
    && key.charCodeAt(2) >= 65   // 'A'
    && key.charCodeAt(2) <= 90;  // 'Z'
}

/** Check if an expression is a static literal. */
function isStaticLiteral(node: t.Expression | t.SpreadElement): boolean {
  return t.isStringLiteral(node)
    || t.isNumericLiteral(node)
    || t.isBooleanLiteral(node)
    || t.isNullLiteral(node)
    || isUndefinedIdentifier(node);
}

/** Check if an expression is `undefined`. */
function isUndefinedIdentifier(node: t.Node): boolean {
  return t.isIdentifier(node) && node.name === 'undefined';
}

/** Check if an expression is a function (arrow or regular). */
function isFunctionExpr(node: t.Node): boolean {
  return t.isArrowFunctionExpression(node) || t.isFunctionExpression(node);
}

// ---------------------------------------------------------------------------
// Classification Priority
// ---------------------------------------------------------------------------

/** Return the higher-priority classification. Island > Dynamic > Static. */
function maxClassification(
  a: SubtreeClassification,
  b: SubtreeClassification,
): SubtreeClassification {
  const order: Record<SubtreeClassification, number> = {
    [SubtreeClassification.Static]: 0,
    [SubtreeClassification.Dynamic]: 1,
    [SubtreeClassification.Island]: 2,
  };
  return order[a] >= order[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Main Classification Function
// ---------------------------------------------------------------------------

/**
 * Classify an h() call expression as static, dynamic, or island.
 * Walks the AST recursively to determine the most "interactive" classification.
 *
 * If the node is not an h() call (using `hBindingName`), it is treated
 * as a leaf and returns Static.
 */
export function classifySubtree(
  node: t.Expression,
  hBindingName: string,
): SubtreeClassification {
  // Step 1: If not an h() call, return Static (leaf node)
  if (
    !t.isCallExpression(node)
    || !t.isIdentifier(node.callee)
    || node.callee.name !== hBindingName
  ) {
    return SubtreeClassification.Static;
  }

  const args = node.arguments;
  if (args.length === 0) {
    return SubtreeClassification.Static;
  }

  // Step 2: Check tag argument
  const tagArg = args[0];
  if (!tagArg || !t.isStringLiteral(tagArg)) {
    // Dynamic tag = full client ownership needed
    return SubtreeClassification.Island;
  }

  let classification = SubtreeClassification.Static;

  // Step 3: Check props
  const propsArg = args.length > 1 ? args[1] : undefined;

  if (
    propsArg
    && !t.isNullLiteral(propsArg)
    && !isUndefinedIdentifier(propsArg)
    && !t.isSpreadElement(propsArg)
  ) {
    if (t.isObjectExpression(propsArg)) {
      for (const prop of propsArg.properties) {
        // Spread or non-ObjectProperty => treat as dynamic
        if (t.isSpreadElement(prop) || !t.isObjectProperty(prop)) {
          classification = maxClassification(classification, SubtreeClassification.Dynamic);
          continue;
        }

        // Extract key name
        const key = t.isIdentifier(prop.key)
          ? prop.key.name
          : t.isStringLiteral(prop.key)
            ? prop.key.value
            : null;

        if (key === null) {
          // Computed key => dynamic
          classification = maxClassification(classification, SubtreeClassification.Dynamic);
          continue;
        }

        // Event handler => Island
        if (isEventProp(key)) {
          return SubtreeClassification.Island;
        }

        // ref or dangerouslySetInnerHTML => Island
        if (key === 'ref' || key === 'dangerouslySetInnerHTML') {
          return SubtreeClassification.Island;
        }

        const val = prop.value;

        // Function expression as prop value => Dynamic
        if (isFunctionExpr(val)) {
          classification = maxClassification(classification, SubtreeClassification.Dynamic);
          continue;
        }

        // Static literal => no change
        if (isStaticLiteral(val as t.Expression)) {
          continue;
        }

        // Any other value (identifier, member expression, call, etc.) => Dynamic
        classification = maxClassification(classification, SubtreeClassification.Dynamic);
      }
    } else {
      // Props is some non-object expression (variable, call, etc.) => dynamic
      classification = maxClassification(classification, SubtreeClassification.Dynamic);
    }
  }

  // Early exit if already Island
  if (classification === SubtreeClassification.Island) {
    return SubtreeClassification.Island;
  }

  // Step 4: Check children (args from index 2 onward)
  for (let i = 2; i < args.length; i++) {
    const childArg = args[i];
    if (!childArg || t.isSpreadElement(childArg)) {
      classification = maxClassification(classification, SubtreeClassification.Dynamic);
      continue;
    }

    const child = childArg as t.Expression;

    // String or number literal => Static (no change)
    if (t.isStringLiteral(child) || t.isNumericLiteral(child)) {
      continue;
    }

    // Another h() call => recursively classify, take max
    if (
      t.isCallExpression(child)
      && t.isIdentifier(child.callee)
      && child.callee.name === hBindingName
    ) {
      const childClass = classifySubtree(child, hBindingName);
      classification = maxClassification(classification, childClass);
      if (classification === SubtreeClassification.Island) {
        return SubtreeClassification.Island;
      }
      continue;
    }

    // Function/arrow function => Dynamic
    if (isFunctionExpr(child)) {
      classification = maxClassification(classification, SubtreeClassification.Dynamic);
      continue;
    }

    // Any other expression => Dynamic
    classification = maxClassification(classification, SubtreeClassification.Dynamic);
  }

  // Step 5: Return the highest classification found
  return classification;
}
