import { render } from 'preact';
import './styles/tokens.css';
import './styles/base.css';

const root = document.getElementById('app');
if (root === null) {
  throw new Error('Missing #app element in index.html');
}

render(
  <main>
    <h1>Make Dinner</h1>
  </main>,
  root,
);
