"""
AI engine for answering custom application questions and generating cover letters.
Uses Claude to intelligently respond to screening questions based on profile data.
"""
import anthropic
import json
import os

client = None

def get_client():
    global client
    if client is None:
        api_key = os.environ.get('ANTHROPIC_API_KEY')
        if not api_key:
            raise ValueError("Set ANTHROPIC_API_KEY environment variable")
        client = anthropic.Anthropic(api_key=api_key)
    return client


def answer_question(question: str, profile: dict, job_info: dict = None) -> str:
    """Use AI to answer a custom application question."""
    job_context = ""
    if job_info:
        job_context = f"""
Job Details:
- Company: {job_info.get('company', 'Unknown')}
- Role: {job_info.get('role', 'Unknown')}
- Description: {job_info.get('description', 'N/A')[:500]}
"""

    prompt = f"""You are filling out a job application for a candidate. Answer this application question
concisely and professionally. Use first person. Keep it under 150 words unless the question clearly
requires more detail. Be specific with real details from the profile.

Candidate Profile:
{json.dumps(profile, indent=2)}

{job_context}

Application Question: {question}

Answer (first person, professional, concise):"""

    resp = get_client().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=300,
        messages=[{"role": "user", "content": prompt}]
    )
    return resp.content[0].text.strip()


def generate_cover_letter(profile: dict, job_info: dict) -> str:
    """Generate a tailored cover letter."""
    prompt = f"""Write a concise, professional cover letter (200-250 words) for this candidate applying to this job.
Be specific - reference actual experience from the profile that matches the job. No fluff.
Do NOT include addresses or date headers. Start with "Dear Hiring Manager," and end with the candidate's name.

Candidate Profile:
{json.dumps(profile, indent=2)}

Job Details:
- Company: {job_info.get('company', 'Unknown')}
- Role: {job_info.get('role', 'Unknown')}
- Description: {job_info.get('description', 'N/A')[:1000]}

Cover Letter:"""

    resp = get_client().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=500,
        messages=[{"role": "user", "content": prompt}]
    )
    return resp.content[0].text.strip()


def score_job_match(profile: dict, job_info: dict) -> dict:
    """Score how well a job matches the candidate profile."""
    prompt = f"""Rate this job match for the candidate on a scale of 1-10. Return ONLY valid JSON.

Candidate Profile:
- Title: {profile.get('current_title')}
- Skills: {', '.join(profile.get('skills', [])[:15])}
- Experience: {profile.get('years_experience')} years
- Summary: {profile.get('summary', '')[:200]}

Job:
- Company: {job_info.get('company', 'Unknown')}
- Role: {job_info.get('role', 'Unknown')}
- Description: {job_info.get('description', 'N/A')[:500]}

Return JSON: {{"score": <1-10>, "reason": "<1 sentence>", "matching_skills": ["skill1", "skill2"]}}"""

    resp = get_client().messages.create(
        model="claude-haiku-4-5-20251001",
        max_tokens=200,
        messages=[{"role": "user", "content": prompt}]
    )

    try:
        text = resp.content[0].text.strip()
        # Extract JSON from response
        if '{' in text:
            json_str = text[text.index('{'):text.rindex('}')+1]
            return json.loads(json_str)
    except Exception:
        pass

    return {"score": 5, "reason": "Could not score", "matching_skills": []}


def classify_question(question: str) -> str:
    """Classify what type of question this is to determine how to answer."""
    q = question.lower()

    if any(w in q for w in ['authorized', 'authorization', 'legally', 'eligible to work']):
        return 'work_auth'
    if any(w in q for w in ['sponsorship', 'visa', 'h1b', 'h-1b']):
        return 'sponsorship'
    if any(w in q for w in ['salary', 'compensation', 'pay', 'expected salary']):
        return 'salary'
    if any(w in q for w in ['years of experience', 'years experience', 'how many years']):
        return 'experience'
    if any(w in q for w in ['relocate', 'relocation', 'willing to move']):
        return 'relocation'
    if any(w in q for w in ['remote', 'on-site', 'hybrid', 'work arrangement']):
        return 'remote'
    if any(w in q for w in ['start date', 'when can you start', 'availability']):
        return 'start_date'
    if any(w in q for w in ['cover letter', 'why this role', 'why are you interested', 'tell us about']):
        return 'cover_letter'
    if any(w in q for w in ['gender', 'race', 'ethnicity', 'veteran', 'disability', 'demographic']):
        return 'eeo'

    return 'custom'


def get_quick_answer(question: str, profile: dict) -> str | None:
    """Try to answer common questions without AI call."""
    qtype = classify_question(question)

    quick_answers = {
        'work_auth': 'Yes',
        'sponsorship': 'No',
        'salary': profile.get('desired_salary', '120000'),
        'experience': profile.get('years_experience', '7'),
        'relocation': 'No' if profile.get('remote_only') else 'Yes',
        'remote': 'Remote',
        'start_date': 'Available to start within 2 weeks of offer acceptance.',
        'eeo': 'Decline to self-identify',
    }

    return quick_answers.get(qtype)
