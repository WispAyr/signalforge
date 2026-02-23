// Hello World Plugin for SignalForge
// Demonstrates the plugin API

export const meta = {
  id: 'hello-world',
  name: 'Hello World',
  version: '1.0.0',
};

export function init(context) {
  console.log('[HelloWorld] Plugin loaded!');

  // Register a simple view panel
  if (context.registerPanel) {
    context.registerPanel({
      id: 'hello-panel',
      title: '👋 Hello World',
      render: (container) => {
        container.innerHTML = `
          <div style="padding: 16px; font-family: monospace; color: #00e5ff;">
            <h2>👋 Hello from Plugin System!</h2>
            <p>This panel was loaded dynamically from <code>data/plugins/hello-world/</code></p>
            <p>Timestamp: ${new Date().toISOString()}</p>
            <p>SignalForge plugin system is working correctly.</p>
          </div>
        `;
      },
    });
  }

  return { dispose: () => console.log('[HelloWorld] Plugin unloaded') };
}
