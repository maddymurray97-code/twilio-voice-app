import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const now = new Date();
  
  // Calculate target times
  const target48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);
  const target24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const target2h = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  
  const format48h = target48h.toISOString().split('T')[0];
  const format24h = target24h.toISOString().split('T')[0];
  const format2h = target2h.toISOString().split('T')[0];
  
  return NextResponse.json({
    currentTime: now.toISOString(),
    sydney: now.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' }),
    lookingFor: {
      '48h': {
        targetDateTime: target48h.toISOString(),
        dateString: format48h,
        sydneyTime: target48h.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })
      },
      '24h': {
        targetDateTime: target24h.toISOString(),
        dateString: format24h,
        sydneyTime: target24h.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })
      },
      '2h': {
        targetDateTime: target2h.toISOString(),
        dateString: format2h,
        sydneyTime: target2h.toLocaleString('en-AU', { timeZone: 'Australia/Sydney' })
      }
    },
    yourAppointment: {
      shouldBe: format2h,
      inAirtableFormat: 'Check your Appointments table Appointment Date field'
    }
  });
}
```

Commit: `Add debug endpoint to check date formats`

Then visit:
```
https://twilio-voice-app-two.vercel.app/api/debug-reminders
