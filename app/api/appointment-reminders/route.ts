import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export async function GET(req: NextRequest) {
  try {
    console.log('⏰ Checking for reminders to send...');
    
    const now = new Date();
    
    // Send 48h reminders
    await sendReminders(now, 48, '48h');
    
    // Send 24h reminders
    await sendReminders(now, 24, '24h');
    
    // Send 2h reminders
    await sendReminders(now, 2, '2h');
    
    return NextResponse.json({ success: true, message: 'Reminders checked' });
    
  } catch (error) {
    console.error('Reminder error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

async function sendReminders(now: Date, hoursAhead: number, reminderType: string) {
  const targetTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  
  // Get start and end of target hour (to catch appointments within that hour)
  const startOfHour = new Date(targetTime);
  startOfHour.setMinutes(0, 0, 0);
  
  const endOfHour = new Date(targetTime);
  endOfHour.setMinutes(59, 59, 999);
  
  const targetDateStart = startOfHour.toISOString().split('T')[0];
  const targetDateEnd = endOfHour.toISOString().split('T')[0];
  
  // Get appointments due in target window that haven't received this reminder
  const appointments = await getAppointmentsDue(targetDateStart, targetDateEnd, reminderType);
  
  console.log(`Found ${appointments.length} appointments needing ${reminderType} reminder`);
  
  for (const apt of appointments) {
    await sendReminderSMS(apt, reminderType);
    await markReminderSent(apt.id, reminderType);
  }
}

async function getAppointmentsDue(targetDateStart: string, targetDateEnd: string, reminderType: string) {
  const reminderField = `Reminder ${reminderType} Sent`;
  
  const formula = `AND(
    OR(
      {Appointment Date} = '${targetDateStart}',
      {Appointment Date} = '${targetDateEnd}'
    ),
    {Status} = 'Scheduled',
    {${reminderField}} = FALSE(),
    NOT({Customer Phone} = '')
  )`;
  
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  return data.records;
}

async function sendReminderSMS(appointment: any, reminderType: string) {
  const fields = appointment.fields;
  const businessPhone = await getBusinessPhone(fields['Business Name'][0]);
  
  if (!fields['Customer Phone']) {
    console.log(`⚠️ Skipping ${fields['Customer Name']} - no phone number`);
    return;
  }
  
  let message = '';
  const customerName = fields['Customer Name'] || 'there';
  const service = fields['Service/Meeting Title'] || 'appointment';
  const time = fields['Appointment Time'];
  const date = formatDate(fields['Appointment Date']);
  
  if (reminderType === '48h') {
    message = `Hi ${customerName}! Excited to see you ${date} at ${time} for your ${service}! 😊`;
  } else if (reminderType === '24h') {
    message = `Reminder: Your ${service} is tomorrow at ${time}. Reply CONFIRM or text if you need to reschedule.`;
  } else if (reminderType === '2h') {
    message = `See you in 2 hours at ${time} for your ${service}! Reply if you have any questions.`;
  }
  
  try {
    await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          To: fields['Customer Phone'],
          From: businessPhone,
          Body: message
        })
      }
    );
    
    console.log(`✅ Sent ${reminderType} reminder to ${customerName}`);
  } catch (error) {
    console.error(`❌ Failed to send to ${customerName}:`, error);
  }
}

async function getBusinessPhone(businessId: string) {
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses/${businessId}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  return data.fields['Twilio Phone Number'];
}

async function markReminderSent(appointmentId: string, reminderType: string) {
  const reminderField = `Reminder ${reminderType} Sent`;
  
  await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments/${appointmentId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        fields: {
          [reminderField]: true
        }
      })
    }
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00');
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}
