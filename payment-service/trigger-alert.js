

async function triggerIncident() {
  const payload = {
    user_email: "hackathon@example.com",
    card_last4: "4242",
    amount: 4999,
    idempotency_key: "hackathon-demo-key"
  };

  try {
    console.log("Sending first charge...");

    const first = await fetch(
      "http://localhost:4000/api/v1/charge",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const firstData = await first.json();

    console.log(firstData);

    console.log("Sending duplicate charge...");

    const second = await fetch(
      "http://localhost:4000/api/v1/charge",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const secondData = await second.json();

    console.log(secondData);

    if (
      firstData.transaction_id ===
      secondData.transaction_id
    ) {
      console.log("✅ Duplicate prevented");
    } else {
      console.log("❌ Duplicate charge detected");
    }

  } catch (error) {
    console.error(error);
  }
}

triggerIncident();