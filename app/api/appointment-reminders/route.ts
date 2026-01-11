import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export async function GET(req: NextRequest) {
  try {
    console.log('⏰ Checking for reminders to send...');
    
    const now = new Date();
    const results = { '24h': 0, '1h': 0 };
    
    // Send 24h reminders
    results['24h'] = await sendReminders(now, 24, '24h');
    
    // Send 1h reminders
    results['1h'] = await sendReminders(now, 1, '1h');
    
    return NextResponse.json({ 
      success: true, 
      message: 'Reminders checked',
      found24h: results['24h'],
      found1h: results['1h'],
      timestamp: now.toISOString()
    });
    
  } catch (error) {
    console.error('Reminder error:', error);
    return NextResponse.json({ 
      error: 'Failed',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}

async function sendReminders(now: Date, hoursAhead: number, reminderType: string): Promise<number> {
  const targetTime = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  
  const month = targetTime.getMonth() + 1;
  const day = targetTime.getDate();
  const year = targetTime.getFullYear();
  const targetDate = `${month}/${day}/${year}`;
  
  console.log(`📅 Looking for ${reminderType} reminders for date: ${targetDate}`);
  
  const appointments = await getAppointmentsDue(targetDate, reminderType);
  
  console.log(`Found ${appointments.length} appointments needing ${reminderType} reminder`);
  
  for (const apt of appointments) {
    await sendReminderSMS(apt, reminderType);
    await markReminderSent(apt.id, reminderType);
  }
  
  return appointments.length;
}

async function getAppointmentsDue(targetDate: string, reminderType: string) {
  const reminderField = `Reminder ${reminderType} Sent`;
  
  const formula = `AND(
    {Status} = 'Scheduled',
    {${reminderField}} = FALSE(),
    NOT({Customer Phone} = '')
  )`;
  
  console.log(`🔍 Airtable formula: ${formula}`);
  
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments?filterByFormula=${encodeURIComponent(formula)}`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  
  console.log(`📋 Found ${data.records?.length || 0} total appointments`);
  
  if (data.records && data.records.length > 0) {
    console.log(`✅ Found appointments for ${data.records.map((r: any) => r.fields['Customer Name']).join(', ')}`);
  }
  
  return data.records || [];
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
  
  if (reminderType === '24h') {
    message = `Hi ${customerName}! Your ${service} appointment is tomorrow at ${time}. Reply CONFIRM to confirm or let us know if you need to reschedule.`;
  } else if (reminderType === '1h') {
    message = `See you in 1 hour at ${time} for your ${service}! Reply if you have any questions.`;
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
  
  console.log(`✅ Marked ${reminderField} for appointment ${appointmentId}`);
}

function formatDate(dateString: string): string {
  const parts = dateString.split('/');
  const month = parseInt(parts[0]);
  const day = parseInt(parts[1]);
  const year = parseInt(parts[2]);
  
  const date = new Date(year, month - 1, day);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}
