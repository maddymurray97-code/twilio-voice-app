import { NextRequest, NextResponse } from 'next/server';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const data = Object.fromEntries(formData);
    
    const customerPhone = data.From as string;
    const messageBody = (data.Body as string).trim().toUpperCase();
    const toNumber = data.To as string;
    
    console.log(`📱 Appointment reply from ${customerPhone}: ${messageBody}`);
    
    // Find upcoming appointment for this customer
    const appointment = await findUpcomingAppointment(customerPhone);
    
    if (!appointment) {
      console.log(`❌ No appointment found for ${customerPhone}`);
      const replyXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>We couldn't find your upcoming appointment. Please call us directly if you need help.</Message></Response>`;
      return new NextResponse(replyXml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' }
      });
    }
    
    console.log(`✅ Found appointment for ${appointment.fields['Customer Name']}`);
    
    const aptFields = appointment.fields;
    
    // Handle CONFIRM
    if (messageBody === 'CONFIRM' || messageBody === 'YES' || messageBody === 'CONFIRMED') {
      await updateAppointmentStatus(appointment.id, 'Confirmed', messageBody);
      
      const replyXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Perfect! Your ${aptFields['Service/Meeting Title']} appointment is confirmed for ${aptFields['Appointment Date']} at ${aptFields['Appointment Time']}. See you then! 🎉</Message></Response>`;
      
      // Notify business owner
      await notifyOwner(appointment, 'confirmed');
      
      return new NextResponse(replyXml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' }
      });
    }
    
    // Handle CANCEL
    if (messageBody === 'CANCEL' || messageBody === 'CANCELLED' || messageBody.includes('CANCEL')) {
      await updateAppointmentStatus(appointment.id, 'Cancelled', messageBody);
      
      const replyXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>No problem! Your appointment has been cancelled. Want to reschedule? Call us or reply with your preferred time and we'll help you book a new slot.</Message></Response>`;
      
      // Notify business owner
      await notifyOwner(appointment, 'cancelled');
      
      return new NextResponse(replyXml, {
        status: 200,
        headers: { 'Content-Type': 'text/xml' }
      });
    }
    
    // Other messages - save response and auto-reply
    await saveCustomerResponse(appointment.id, messageBody);
    
    // Forward to business owner
    await forwardToOwner(appointment, customerPhone, messageBody);
    
    const replyXml = `<?xml version="1.0" encoding="UTF-8"?><Response><Message>Thanks for your message! We'll get back to you shortly about your appointment.</Message></Response>`;
    
    return new NextResponse(replyXml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
      });
    
  } catch (error) {
    console.error('Reply error:', error);
    return new NextResponse('', { status: 200 });
  }
}

async function findUpcomingAppointment(customerPhone: string) {
  console.log(`🔍 Looking for appointment with phone: ${customerPhone}`);
  
  // Simplified: Find ANY appointment with this phone that's Scheduled or Confirmed
  const formula = `AND(
    {Customer Phone} = '${customerPhone}',
    OR({Status} = 'Scheduled', {Status} = 'Confirmed')
  )`;
  
  console.log(`📋 Airtable formula: ${formula}`);
  
  const url = `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Appointments?filterByFormula=${encodeURIComponent(formula)}&sort[0][field]=Appointment Date&sort[0][direction]=asc`;
  
  const response = await fetch(url, {
    headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
  });
  
  const data = await response.json();
  console.log(`📋 Found ${data.records?.length || 0} matching appointments`);
  
  if (data.records && data.records.length > 0) {
    console.log(`First appointment: ${data.records[0].fields['Customer Name']} on ${data.records[0].fields['Appointment Date']}`);
  }
  
  return data.records[0];
}

async function updateAppointmentStatus(appointmentId: string, status: string, response: string) {
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
          'Status': status,
          'Customer Response': response
        }
      })
    }
  );
  
  console.log(`✅ Updated appointment ${appointmentId} to ${status}`);
}

async function saveCustomerResponse(appointmentId: string, response: string) {
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
          'Customer Response': response
        }
      })
    }
  );
}

async function notifyOwner(appointment: any, action: string) {
  const fields = appointment.fields;
  const businessId = fields['Business Name'][0];
  
  const businessData = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses/${businessId}`,
    {
      headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
    }
  );
  
  const business = await businessData.json();
  const ownerPhone = business.fields['Owner Phone Number'];
  const twilioPhone = business.fields['Twilio Phone Number'];
  
  if (!ownerPhone) return;
  
  const message = action === 'confirmed' 
    ? `✅ ${fields['Customer Name']} CONFIRMED their appointment on ${fields['Appointment Date']} at ${fields['Appointment Time']}`
    : `❌ ${fields['Customer Name']} CANCELLED their appointment on ${fields['Appointment Date']} at ${fields['Appointment Time']}. You can now fill this slot!`;
  
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: ownerPhone,
        From: twilioPhone,
        Body: message
      })
    }
  );
  
  console.log(`📨 Notified owner about ${action}`);
}

async function forwardToOwner(appointment: any, customerPhone: string, message: string) {
  const fields = appointment.fields;
  const businessId = fields['Business Name'][0];
  
  const businessData = await fetch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses/${businessId}`,
    {
      headers: { 'Authorization': `Bearer ${AIRTABLE_API_KEY}` }
    }
  );
  
  const business = await businessData.json();
  const ownerPhone = business.fields['Owner Phone Number'];
  const twilioPhone = business.fields['Twilio Phone Number'];
  
  if (!ownerPhone) return;
  
  const forwardMessage = `[APPOINTMENT MESSAGE] ${fields['Customer Name']}\n\nFrom: ${customerPhone}\nRe: ${fields['Service/Meeting Title']} on ${fields['Appointment Date']}\n\nMessage: ${message}\n\nReply to this thread to respond.`;
  
  await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        To: ownerPhone,
        From: twilioPhone,
        Body: forwardMessage
      })
    }
  );
  
  console.log(`📨 Forwarded message to owner`);
}
