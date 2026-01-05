import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    console.log('📞 Twilio webhook called');
    
    const formData = await req.formData();
    const data = Object.fromEntries(formData);
    
    console.log('📞 Call data:', data);
    
    const xml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Thank you for calling. This is a test message.</Say></Response>';
    
    return new NextResponse(xml, {
      status: 200,
      headers: { 'Content-Type': 'text/xml' },
    });
  } catch (error) {
    console.error('Error:', error);
    const errorXml = '<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">An error occurred.</Say></Response>';
    return new NextResponse(errorXml, { 
      status: 200,
      headers: { 'Content-Type': 'text/xml' }
    });
  }
}
