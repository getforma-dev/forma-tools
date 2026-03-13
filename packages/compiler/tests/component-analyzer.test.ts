import { describe, it, expect } from 'vitest';
import { ComponentAnalyzer, type SignalDefault } from '../src/component-analyzer';

const analyzer = new ComponentAnalyzer('/test/project');

// ===========================================================================
// Task 6: Entry Point Parsing — parseEntryPoint
// ===========================================================================

describe('parseEntryPoint', () => {
  it('finds mount with named component import', () => {
    const source = `
      import { mount } from 'formajs';
      import { OnboardingPage } from './OnboardingPage';
      mount(() => OnboardingPage(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'OnboardingPage',
      importPath: './OnboardingPage',
    });
  });

  it('returns null when no mount call exists', () => {
    const source = `
      import { h } from 'formajs';
      const app = h('div', null, 'Hello');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toBeNull();
  });

  it('handles default import', () => {
    const source = `
      import { mount } from 'formajs';
      import Dashboard from './Dashboard';
      mount(() => Dashboard(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'Dashboard',
      importPath: './Dashboard',
    });
  });

  it('handles different component names', () => {
    const source = `
      import { mount } from 'formajs';
      import { UserProfile } from './pages/UserProfile';
      mount(() => UserProfile(), '#root');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'UserProfile',
      importPath: './pages/UserProfile',
    });
  });

  it('handles mount with direct component reference (no arrow)', () => {
    const source = `
      import { mount } from 'formajs';
      import { App } from './App';
      mount(App, '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'App',
      importPath: './App',
    });
  });

  it('returns null when component is not imported', () => {
    const source = `
      import { mount } from 'formajs';
      function LocalComponent() { return null; }
      mount(() => LocalComponent(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toBeNull();
  });

  it('handles re-exported named import', () => {
    const source = `
      import { mount } from 'formajs';
      import { LoginPage as Page } from './LoginPage';
      mount(() => Page(), '#app');
    `;
    const result = analyzer.parseEntryPoint(source, 'app.ts');
    expect(result).toEqual({
      componentName: 'Page',
      importPath: './LoginPage',
    });
  });
});

// ===========================================================================
// Task 6: Entry Point Parsing — parseComponentFile
// ===========================================================================

describe('parseComponentFile', () => {
  it('extracts return node from exported function declaration', () => {
    const source = `
      import { h, createSignal } from 'formajs';
      export function OnboardingPage() {
        const [email, setEmail] = createSignal('');
        return h('div', { class: 'page' }, h('h1', null, 'Welcome'));
      }
    `;
    const result = analyzer.parseComponentFile(source, 'OnboardingPage.ts', 'OnboardingPage');
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('OnboardingPage');
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('returns null for non-existent function name', () => {
    const source = `
      export function MyComponent() {
        return h('div', null, 'Hello');
      }
    `;
    const result = analyzer.parseComponentFile(source, 'MyComponent.ts', 'OtherComponent');
    expect(result).toBeNull();
  });

  it('returns null for non-exported function', () => {
    const source = `
      function MyComponent() {
        return h('div', null, 'Hello');
      }
    `;
    const result = analyzer.parseComponentFile(source, 'file.ts', 'MyComponent');
    expect(result).toBeNull();
  });

  it('handles exported arrow function with expression body', () => {
    const source = `
      import { h } from 'formajs';
      export const Card = () => h('div', { class: 'card' }, 'Content');
    `;
    const result = analyzer.parseComponentFile(source, 'Card.ts', 'Card');
    expect(result).not.toBeNull();
    expect(result!.functionName).toBe('Card');
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('handles exported arrow function with block body', () => {
    const source = `
      import { h } from 'formajs';
      export const Card = () => {
        const title = 'Hello';
        return h('div', null, title);
      };
    `;
    const result = analyzer.parseComponentFile(source, 'Card.ts', 'Card');
    expect(result).not.toBeNull();
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('handles exported function expression', () => {
    const source = `
      import { h } from 'formajs';
      export const Widget = function() {
        return h('span', null, 'widget');
      };
    `;
    const result = analyzer.parseComponentFile(source, 'Widget.ts', 'Widget');
    expect(result).not.toBeNull();
    expect(result!.returnNode.type).toBe('CallExpression');
  });

  it('does not extract return from nested function', () => {
    const source = `
      export function Outer() {
        function inner() {
          return h('span', null, 'inner');
        }
        return h('div', null, 'outer');
      }
    `;
    const result = analyzer.parseComponentFile(source, 'file.ts', 'Outer');
    expect(result).not.toBeNull();
    // Should get the outer return, not the inner one
    // The outer return is h('div', ...) — check it's a call expression
    expect(result!.returnNode.type).toBe('CallExpression');
  });
});

// ===========================================================================
// Task 7: File-level Constant Extraction
// ===========================================================================

describe('extractFileConstants', () => {
  it('extracts const array of objects with string values', () => {
    const source = `
      const CAPABILITIES = [
        { title: 'Multi-Tenant Auth', description: 'Isolated user pools per tenant' },
        { title: 'OAuth + MFA', description: 'Google and GitHub SSO' },
      ];

      export function Page() { return null; }
    `;
    const result = analyzer.extractFileConstants(source, 'page.ts');
    expect(result.size).toBe(1);
    expect(result.get('CAPABILITIES')).toEqual([
      { title: 'Multi-Tenant Auth', description: 'Isolated user pools per tenant' },
      { title: 'OAuth + MFA', description: 'Google and GitHub SSO' },
    ]);
  });

  it('handles objects with mixed primitive types', () => {
    const source = `
      const ITEMS = [
        { name: 'Widget', count: 42, active: true },
        { name: 'Gadget', count: 0, active: false },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.get('ITEMS')).toEqual([
      { name: 'Widget', count: 42, active: true },
      { name: 'Gadget', count: 0, active: false },
    ]);
  });

  it('ignores non-const declarations', () => {
    const source = `
      let ITEMS = [{ name: 'a' }];
      var OTHER = [{ name: 'b' }];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('ignores non-array const declarations', () => {
    const source = `
      const NAME = 'hello';
      const COUNT = 42;
      const OBJ = { key: 'val' };
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('ignores arrays with non-object elements', () => {
    const source = `
      const NAMES = ['Alice', 'Bob', 'Charlie'];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('ignores arrays with objects containing non-primitive values', () => {
    const source = `
      const ITEMS = [
        { name: 'Widget', handler: () => console.log('click') },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('handles empty array', () => {
    const source = `
      const EMPTY = [];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(1);
    expect(result.get('EMPTY')).toEqual([]);
  });

  it('returns empty map for no constants', () => {
    const source = `
      export function Component() { return null; }
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('extracts multiple constants', () => {
    const source = `
      const FEATURES = [
        { name: 'Auth', enabled: true },
      ];
      const PLANS = [
        { name: 'Free', price: 0 },
        { name: 'Pro', price: 29 },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(2);
    expect(result.get('FEATURES')).toEqual([{ name: 'Auth', enabled: true }]);
    expect(result.get('PLANS')).toEqual([
      { name: 'Free', price: 0 },
      { name: 'Pro', price: 29 },
    ]);
  });

  it('ignores constants inside function bodies', () => {
    const source = `
      export function Component() {
        const LOCAL = [{ key: 'val' }];
        return null;
      }
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.size).toBe(0);
  });

  it('handles objects with string-literal keys', () => {
    const source = `
      const DATA = [
        { 'data-testid': 'card', 'aria-label': 'info' },
      ];
    `;
    const result = analyzer.extractFileConstants(source, 'file.ts');
    expect(result.get('DATA')).toEqual([
      { 'data-testid': 'card', 'aria-label': 'info' },
    ]);
  });
});

// ===========================================================================
// Task 8: Signal Initial Value Detection
// ===========================================================================

describe('extractSignalDefaults', () => {
  it('detects string initial value', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function Page() {
        const [email, setEmail] = createSignal('');
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.size).toBe(1);
    expect(result.get('email')).toEqual({ type: 'text', default: '' });
  });

  it('detects non-empty string initial value', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function Page() {
        const [name, setName] = createSignal('Alice');
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.get('name')).toEqual({ type: 'text', default: 'Alice' });
  });

  it('detects boolean initial value', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function Page() {
        const [submitting, setSubmitting] = createSignal(false);
        const [visible, setVisible] = createSignal(true);
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.get('submitting')).toEqual({ type: 'bool', default: false });
    expect(result.get('visible')).toEqual({ type: 'bool', default: true });
  });

  it('detects number initial value', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function Page() {
        const [count, setCount] = createSignal(0);
        const [price, setPrice] = createSignal(9.99);
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.get('count')).toEqual({ type: 'number', default: 0 });
    expect(result.get('price')).toEqual({ type: 'number', default: 9.99 });
  });

  it('detects null initial value', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function Page() {
        const [error, setError] = createSignal<string | null>(null);
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.get('error')).toEqual({ type: 'null', default: null });
  });

  it('detects all signal types in the same function', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function OnboardingPage() {
        const [email, setEmail] = createSignal('');
        const [submitting, setSubmitting] = createSignal(false);
        const [showPassword, setShowPassword] = createSignal(false);
        const [error, setError] = createSignal<string | null>(null);
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'OnboardingPage');
    expect(result.size).toBe(4);
    expect(result.get('email')).toEqual({ type: 'text', default: '' });
    expect(result.get('submitting')).toEqual({ type: 'bool', default: false });
    expect(result.get('showPassword')).toEqual({ type: 'bool', default: false });
    expect(result.get('error')).toEqual({ type: 'null', default: null });
  });

  it('ignores non-createSignal patterns', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function Page() {
        const [a, b] = someOtherFunction('hello');
        const items = [1, 2, 3];
        const name = 'test';
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.size).toBe(0);
  });

  it('returns empty map when no signals exist', () => {
    const source = `
      export function Page() {
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.size).toBe(0);
  });

  it('returns empty map when function not found', () => {
    const source = `
      export function Other() {
        const [val, setVal] = createSignal('test');
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.size).toBe(0);
  });

  it('ignores signals with unsupported initial values', () => {
    const source = `
      import { createSignal } from 'formajs';
      export function Page() {
        const [data, setData] = createSignal({ key: 'val' });
        const [list, setList] = createSignal([1, 2, 3]);
        const [name, setName] = createSignal('hello');
        return null;
      }
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    // Only 'name' should be detected — object and array are unsupported
    expect(result.size).toBe(1);
    expect(result.get('name')).toEqual({ type: 'text', default: 'hello' });
  });

  it('works with exported const arrow function', () => {
    const source = `
      import { createSignal } from 'formajs';
      export const Page = () => {
        const [count, setCount] = createSignal(0);
        return null;
      };
    `;
    const result = analyzer.extractSignalDefaults(source, 'page.ts', 'Page');
    expect(result.size).toBe(1);
    expect(result.get('count')).toEqual({ type: 'number', default: 0 });
  });
});
