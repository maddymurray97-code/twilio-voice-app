export default function Home() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center">
        <h1 className="text-4xl font-bold mb-4">Twilio Voice App</h1>
        <p className="text-xl">Your webhook is ready at:</p>
        <code className="bg-gray-100 p-2 rounded mt-2 block">
          /api/call-status
        </code>
      </div>
    </main>
  );
}
