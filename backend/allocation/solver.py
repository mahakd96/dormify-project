"""
DORMIFY - Allocation Algorithm using MiniZinc
This is the smart allocation that matches students to rooms
"""

from api.models import Student, Room, Apartment

# Try to import MiniZinc (optional - will use fallback if not installed)
try:
    import minizinc
    MINIZINC_AVAILABLE = True
except ImportError:
    MINIZINC_AVAILABLE = False
    print("⚠️ MiniZinc not installed. Using fallback algorithm.")


def run_allocation_algorithm(region):
    """
    Run the allocation algorithm for a region.
    
    Rules (Constraints):
    1. Same gender in apartment
    2. Same religion in apartment
    3. Try to match roommate requests
    4. Priority students get assigned first
    5. No Jewish + Arab in same apartment
    
    Returns:
        dict with results
    """
    
    # Get unassigned students in this region
    students = list(Student.objects.filter(
        region=region,
        is_active=True,
        assigned_room__isnull=True
    ).order_by('-is_priority', 'last_name'))
    
    # Get available rooms in this region
    rooms = list(Room.objects.filter(
        apartment__building__region=region,
        is_active=True
    ))
    
    # Filter rooms that have space
    available_rooms = [r for r in rooms if not r.is_full]
    
    if not students:
        return {
            'students_processed': 0,
            'successful_assignments': 0,
            'roommate_matches': 0,
            'conflicts': 0
        }
    
    if MINIZINC_AVAILABLE:
        return _run_minizinc_allocation(students, available_rooms)
    else:
        return _run_fallback_allocation(students, available_rooms)


def _run_minizinc_allocation(students, rooms):
    """
    Run allocation using MiniZinc constraint solver
    """
    # TODO: Implement MiniZinc model
    # For now, use fallback
    return _run_fallback_allocation(students, rooms)


def _run_fallback_allocation(students, rooms):
    """
    Simple greedy allocation algorithm (fallback when MiniZinc not available)
    """
    
    results = {
        'students_processed': len(students),
        'successful_assignments': 0,
        'roommate_matches': 0,
        'conflicts': 0
    }
    
    # Group rooms by apartment
    apartment_rooms = {}
    for room in rooms:
        apt_id = room.apartment_id
        if apt_id not in apartment_rooms:
            apartment_rooms[apt_id] = {
                'apartment': room.apartment,
                'rooms': [],
                'gender': None,
                'religion': None
            }
        apartment_rooms[apt_id]['rooms'].append(room)
    
    # Track roommate requests
    roommate_requests = {}
    for student in students:
        if student.roommate_request_id:
            roommate_requests[student.student_id] = student.roommate_request_id
    
    # Sort students: priority first, then by roommate requests
    priority_students = [s for s in students if s.is_priority]
    regular_students = [s for s in students if not s.is_priority]
    
    # Process priority students first
    for student in priority_students:
        room = _find_suitable_room(student, apartment_rooms)
        if room:
            _assign_student_to_room(student, room, apartment_rooms)
            results['successful_assignments'] += 1
        else:
            results['conflicts'] += 1
    
    # Process regular students
    # First, try to match roommates
    processed = set()
    
    for student in regular_students:
        if student.student_id in processed:
            continue
        
        # Check if has roommate request
        if student.roommate_request_id:
            # Find the roommate
            roommate = next(
                (s for s in regular_students 
                 if s.student_id == student.roommate_request_id 
                 and s.student_id not in processed),
                None
            )
            
            if roommate:
                # Check if mutual request
                is_mutual = roommate.roommate_request_id == student.student_id
                
                # Check if same gender and religion
                if student.gender == roommate.gender and student.religion == roommate.religion:
                    # Find room for both
                    room = _find_suitable_room_for_pair(student, roommate, apartment_rooms)
                    if room:
                        _assign_student_to_room(student, room, apartment_rooms)
                        _assign_student_to_room(roommate, room, apartment_rooms)
                        results['successful_assignments'] += 2
                        if is_mutual:
                            results['roommate_matches'] += 1
                        processed.add(student.student_id)
                        processed.add(roommate.student_id)
                        continue
    
    # Assign remaining students
    for student in regular_students:
        if student.student_id in processed:
            continue
        
        room = _find_suitable_room(student, apartment_rooms)
        if room:
            _assign_student_to_room(student, room, apartment_rooms)
            results['successful_assignments'] += 1
        else:
            results['conflicts'] += 1
        
        processed.add(student.student_id)
    
    return results


def _find_suitable_room(student, apartment_rooms):
    """Find a suitable room for a student"""
    
    for apt_id, apt_data in apartment_rooms.items():
        apt = apt_data['apartment']
        
        # Skip reserved apartments (unless student is priority)
        if apt.is_reserved and not student.is_priority:
            continue
        
        # Check gender constraint
        if apt_data['gender'] and apt_data['gender'] != student.gender:
            continue
        
        # Check religion constraint
        if apt_data['religion'] and apt_data['religion'] != student.religion:
            continue
        
        # Check forbidden combinations (Jewish + Arab)
        if apt_data['religion'] == 'jewish' and student.religion in ['muslim', 'druze']:
            continue
        if apt_data['religion'] in ['muslim', 'druze'] and student.religion == 'jewish':
            continue
        
        # Find available room in this apartment
        for room in apt_data['rooms']:
            if not room.is_full:
                return room
    
    return None


def _find_suitable_room_for_pair(student1, student2, apartment_rooms):
    """Find a room that can fit both students"""
    
    for apt_id, apt_data in apartment_rooms.items():
        apt = apt_data['apartment']
        
        # Check gender (must match both students, and they should be same)
        if apt_data['gender'] and apt_data['gender'] != student1.gender:
            continue
        
        # Check religion
        if apt_data['religion'] and apt_data['religion'] != student1.religion:
            continue
        
        # Find room with 2 available beds
        for room in apt_data['rooms']:
            if room.available_beds >= 2:
                return room
    
    return None


def _assign_student_to_room(student, room, apartment_rooms):
    """Assign a student to a room and update tracking"""
    
    student.assigned_room = room
    student.save()
    
    # Update apartment gender/religion tracking
    apt_id = room.apartment_id
    if apt_id in apartment_rooms:
        if not apartment_rooms[apt_id]['gender']:
            apartment_rooms[apt_id]['gender'] = student.gender
        if not apartment_rooms[apt_id]['religion']:
            apartment_rooms[apt_id]['religion'] = student.religion
